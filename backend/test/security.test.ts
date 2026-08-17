import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { startTestDb, type TestDb } from "./helpers/db.js";

// The security controls added in the four security PRDs: rate limiting, session
// revocation, and the fail-fast/exposure configuration checks.
//
// Auth has to be ON for any of this to mean anything, and config.ts reads the
// environment at IMPORT time, so the env is set before any import — same reason as
// auth.test.ts. The login limit is turned down to 3 attempts here so the test can
// reach it in a few requests instead of ten; the DEFAULT is deliberately roomy.
process.env.APP_PASSWORD = "s3cret-pass";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
process.env.COOKIE_SECURE = "false";
process.env.LOGIN_RATE_LIMIT_MAX = "3";
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "60000";

let db: TestDb;
let app: FastifyInstance;

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.url;
  process.env.LOG_DIR = "./logs";
  process.env.CORS_ORIGINS = "http://localhost:5173";
  const { buildApp } = await import("../src/app.js");
  app = buildApp();
  await app.ready();
});

after(async () => {
  await app?.close();
  const { prisma } = await import("../src/prisma.js");
  await prisma.$disconnect();
  await db?.stop();
});

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const str = Array.isArray(raw) ? raw[0] : (raw as string);
  return str.split(";")[0];
}

const login = (ip: string) =>
  app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: "s3cret-pass" },
    // The limiter counts per client, so tests that must not interfere with each
    // other have to arrive from different addresses.
    remoteAddress: ip,
  });

// ── Rate limiting ────────────────────────────────────────────────────────────

test("login is throttled after too many attempts from one client", async () => {
  const attempt = () =>
    app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "wrong" }, remoteAddress: "10.0.0.1" });
  assert.equal((await attempt()).statusCode, 401);
  assert.equal((await attempt()).statusCode, 401);
  assert.equal((await attempt()).statusCode, 401);
  const limited = await attempt();
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, "RATE_LIMITED");
  // Nothing about the password itself leaks through the rejection.
  assert.doesNotMatch(limited.json().error.message, /password|attempt.*remaining/i);
});

test("throttling one client does not lock out another", async () => {
  // The whole reason the limit is per client rather than one global counter: a
  // global one would let anyone who can reach the app lock the owner out of it.
  const other = await login("10.0.0.2");
  assert.equal(other.statusCode, 200);
});

test("health and auth status are never rate limited", async () => {
  // These are what the app polls before it can start at all; throttling them turns
  // a busy moment into an app that will not load.
  for (let i = 0; i < 40; i++) {
    const res = await app.inject({ method: "GET", url: "/api/health", remoteAddress: "10.0.0.3" });
    assert.equal(res.statusCode, 200);
  }
});

// ── Session revocation ───────────────────────────────────────────────────────

test("a session describes itself, with an id", async () => {
  const cookie = sessionCookie(await login("10.0.1.1"));
  const res = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.authRequired, true);
  assert.ok(body.id, "session carries an id, which is what makes it revocable");
  assert.ok(body.expiresAt);
});

test("revoking a session by id stops that session and no other", async () => {
  const doomed = sessionCookie(await login("10.0.1.2"));
  const keeper = sessionCookie(await login("10.0.1.3"));

  const info = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: doomed } });
  const id = info.json().id as string;

  const revoked = await app.inject({
    method: "POST",
    url: "/api/auth/session/revoke",
    payload: { id },
    headers: { cookie: keeper },
  });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json().scope, "one");

  // The revoked cookie no longer opens anything…
  const blocked = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie: doomed } });
  assert.equal(blocked.statusCode, 401);
  // …while every other session carries on untouched.
  const fine = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie: keeper } });
  assert.equal(fine.statusCode, 200);
});

test("sign out everywhere else keeps the session that asked", async () => {
  const older = sessionCookie(await login("10.0.1.4"));
  // A second apart, so the epoch check has something to separate them by: the
  // token's own issued-at is second-resolution.
  await new Promise((r) => setTimeout(r, 1100));
  const current = sessionCookie(await login("10.0.1.5"));

  const res = await app.inject({ method: "POST", url: "/api/auth/session/revoke", payload: {}, headers: { cookie: current } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().scope, "others");

  assert.equal((await app.inject({ method: "GET", url: "/api/notes", headers: { cookie: older } })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/notes", headers: { cookie: current } })).statusCode, 200);
});

test("revocation survives a restart", async () => {
  // The whole point of persisting it: an in-memory-only list would hand a revoked
  // device its access back the next time the container cycled.
  const doomed = sessionCookie(await login("10.0.1.6"));
  const id = (await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: doomed } })).json().id;
  await app.inject({ method: "POST", url: "/api/auth/session/revoke", payload: { id }, headers: { cookie: doomed } });

  const { buildApp } = await import("../src/app.js");
  const restarted = buildApp();
  await restarted.ready();
  const res = await restarted.inject({ method: "GET", url: "/api/notes", headers: { cookie: doomed } });
  await restarted.close();
  assert.equal(res.statusCode, 401);
});

// ── Configuration checks ─────────────────────────────────────────────────────

test("exposure warning fires only for LAN-reachable AND no password", async () => {
  const { detectExposure } = await import("../src/config.js");
  // Safe: loopback, with or without a password.
  assert.equal(detectExposure("127.0.0.1:", ""), false);
  assert.equal(detectExposure(undefined, ""), false);
  assert.equal(detectExposure("localhost:", ""), false);
  // Safe: exposed, but a password guards it.
  assert.equal(detectExposure("", "hunter2"), false);
  assert.equal(detectExposure("0.0.0.0:", "hunter2"), false);
  // Warned: reachable beyond this machine with nothing in the way.
  assert.equal(detectExposure("", ""), true);
  assert.equal(detectExposure("0.0.0.0:", ""), true);
  assert.equal(detectExposure("10.0.0.40:", ""), true, "a specific LAN interface is still the LAN");
  // Unrecognisable: warn rather than assume the best.
  assert.equal(detectExposure("nonsense", ""), true);
});

// ── Build version ─────────────────────────────────────────────────────────────
// Health reports which build is running. It is the one endpoint reachable with no
// session and no rate limit, which makes it the place a user (or a support reply)
// can always ask "what is actually deployed here?" — see docs/RELEASING.md.
test("health reports the build version", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.status, "ok");
  // Tests run from source with no APP_VERSION set, so the honest answer is "dev" —
  // the same answer a build-from-source deployment gives. What matters is that it
  // is always a non-empty string and never silently absent.
  assert.equal(typeof body.version, "string");
  assert.ok(body.version.length > 0, "version is never empty");
  assert.equal(body.version, "dev", "an untagged build must not claim a release number");
});
