import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { startTestDb, type TestDb } from "./helpers/db.js";

// Tests for the password gate: login, logout, session cookies, and the fact that
// protected routes actually refuse an unauthenticated caller.
//
// Auth is off unless a password is configured, so this file has to configure one —
// which is why the env is set at the very top. config.ts reads process.env at
// IMPORT time (deliberately: fail fast on a misconfigured server), so anything set
// after the import would arrive too late and the app would build with auth disabled,
// making every assertion here pass for the wrong reason.
//
// Set auth env BEFORE importing config/app (config reads env at import time).
process.env.APP_PASSWORD = "s3cret-pass";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
process.env.COOKIE_SECURE = "false";

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

// Extract the session cookie from a login response.
function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const str = Array.isArray(raw) ? raw[0] : (raw as string);
  return str.split(";")[0]; // "lockpad_session=<jwt>"
}

test("status reports auth required and unauthenticated", async () => {
  const res = await app.inject({ method: "GET", url: "/api/auth/status" });
  assert.deepEqual(res.json(), { authRequired: true, authenticated: false });
});

test("protected route is 401 without a session", async () => {
  const res = await app.inject({ method: "GET", url: "/api/notes" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, "UNAUTHORIZED");
});

test("health and login stay public", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/health" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/auth/status" })).statusCode, 200);
});

test("wrong password → 401, no cookie", async () => {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "nope" } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["set-cookie"], undefined);
});

test("correct password sets a session that unlocks protected routes", async () => {
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "s3cret-pass", remember: true } });
  assert.equal(login.statusCode, 200);
  const cookie = sessionCookie(login);
  assert.match(cookie, /^lockpad_session=/);

  // With the cookie, the protected route works.
  const ok = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie } });
  assert.equal(ok.statusCode, 200);

  // status now authenticated.
  const status = await app.inject({ method: "GET", url: "/api/auth/status", headers: { cookie } });
  assert.deepEqual(status.json(), { authRequired: true, authenticated: true });
});

test("remember=false sets a session cookie (no Max-Age)", async () => {
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "s3cret-pass", remember: false } });
  const raw = login.headers["set-cookie"];
  const str = Array.isArray(raw) ? raw[0] : (raw as string);
  assert.doesNotMatch(str, /Max-Age/i, "no Max-Age → clears when browser closes");
});

test("logout clears the cookie", async () => {
  const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
  assert.equal(res.statusCode, 200);
  const raw = res.headers["set-cookie"];
  const str = Array.isArray(raw) ? raw[0] : (raw as string);
  assert.match(str, /lockpad_session=;/); // cleared
});

test("a forged/garbage token is rejected", async () => {
  const res = await app.inject({ method: "GET", url: "/api/notes", headers: { cookie: "lockpad_session=not.a.jwt" } });
  assert.equal(res.statusCode, 401);
});
