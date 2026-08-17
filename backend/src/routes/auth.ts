// The login handshake: status, login, logout.
//
// These three are the only routes reachable WITHOUT a session (see PUBLIC_PATHS in
// app.ts) — everything else is behind the cookie.
//
// `/auth/status` is what the app asks on startup, and it answers two questions at
// once: is a password configured at all, and if so are we currently logged in. That
// first half is why it must be public — a client cannot know whether it needs to
// show a login screen until the server tells it whether there is anything to log
// into.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, insecurelyExposed, EXPOSURE_WARNING } from "../config.js";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  authRequired,
  checkPassword,
  readSession,
  signSession,
  verifySession,
} from "../auth.js";
import { revokeAllExcept, revokeSession } from "../lib/sessionRevocation.js";

const loginSchema = z.object({
  password: z.string().min(1),
  // "Remember me": persist a 30-day cookie so it doesn't ask every time.
  remember: z.boolean().optional().default(true),
});

export async function authRoutes(app: FastifyInstance) {
  // Whether auth is enabled, and whether this request is already authenticated.
  app.get("/auth/status", async (request) => {
    const required = authRequired();
    const authenticated = required ? await verifySession(request.cookies[SESSION_COOKIE]) : true;
    return {
      authRequired: required,
      authenticated,
      // The exposure warning rides along here because this is the one call the app
      // makes before it can show anything, so the banner arrives with the first
      // paint. It is only ever populated in the exposed-AND-no-password case — which
      // is precisely the case where there is no login to leak it past anyway.
      ...(insecurelyExposed ? { warning: EXPOSURE_WARNING } : {}),
    };
  });

  // Brute force is the only attack a single shared password really invites, so this
  // route gets its own limit, far tighter than the global one: ten attempts a
  // quarter of an hour. That is roomy for someone mistyping a passphrase two or
  // three times and hopeless for anyone working through a wordlist.
  //
  // Keyed per client rather than as one global counter — a global counter would let
  // anyone who can reach the app lock the owner out of it by failing ten logins,
  // turning a brute-force defence into a denial-of-service lever.
  const loginRateLimit = {
    rateLimit: {
      max: config.loginRateLimitMax,
      timeWindow: config.loginRateLimitWindowMs,
      // Says nothing about the password itself — not how close a guess was, not how
      // many attempts remain. Shaped for the error handler in app.ts, which turns it
      // into the same error envelope every other route returns.
      errorResponseBuilder: () => ({
        statusCode: 429,
        code: "RATE_LIMITED",
        message: "Too many login attempts. Try again later.",
      }),
    },
  };

  app.post("/auth/login", { config: loginRateLimit }, async (request, reply) => {
    if (!authRequired()) return { ok: true }; // auth disabled — nothing to do
    const { password, remember } = loginSchema.parse(request.body);
    if (!checkPassword(password)) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Incorrect password" } });
    }
    const token = await signSession();
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      path: "/",
      // Persistent cookie when "remember" is on; otherwise a session cookie that
      // clears when the browser closes.
      ...(remember ? { maxAge: SESSION_MAX_AGE } : {}),
    });
    return { ok: true };
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // ── Sessions ───────────────────────────────────────────────────────────────
  //
  // The server keeps no list of who is logged in — that is the point of a stateless
  // token — so these are deliberately thin: this session can describe itself, and
  // any session can be taken away by id or in bulk. There is no "list my devices",
  // because building one would mean storing every session, which is exactly the
  // design being preserved.

  // What this device is holding. The id is what the operator would quote to revoke
  // this particular session from somewhere else.
  app.get("/auth/session", async (request, reply) => {
    if (!authRequired()) return { authRequired: false };
    const session = await readSession(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Not signed in" } });
    return {
      authRequired: true,
      id: session.id ?? null,
      issuedAt: session.issuedAt ? new Date(session.issuedAt * 1000).toISOString() : null,
      expiresAt: session.expiresAt ? new Date(session.expiresAt * 1000).toISOString() : null,
    };
  });

  // Revoke one session by id, or — with no id — every session except this one.
  //
  // Revoking the session making the request is allowed rather than refused, and it
  // does what it says: the cookie is cleared and this device is signed out too. The
  // alternative (a special case that rejects it) would be a rule to remember for no
  // benefit.
  const revokeSchema = z.object({ id: z.string().min(1).optional() });

  app.post("/auth/session/revoke", async (request, reply) => {
    if (!authRequired()) return { ok: true, revoked: 0 };
    const current = await readSession(request.cookies[SESSION_COOKIE]);
    if (!current) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Not signed in" } });
    const { id } = revokeSchema.parse(request.body ?? {});
    if (id) {
      // A revoked id only needs to be remembered until the token would have expired
      // on its own; without knowing that token's expiry, assume the full lifetime.
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);
      await revokeSession(id, expiresAt);
      if (id === current.id) reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true, scope: "one" as const, signedOutHere: id === current.id };
    }
    await revokeAllExcept(current.id ?? null);
    return { ok: true, scope: "others" as const };
  });
}
