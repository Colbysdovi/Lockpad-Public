// Fastify app factory. Wiring only — routes are registered from ./routes.
// Logs go to a file under LOG_DIR (a mounted NAS volume), never a cloud service.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { config, EXPOSURE_WARNING, insecurelyExposed } from "./config.js";
import { ApiError, type ErrorBody } from "./errors.js";
import { SESSION_COOKIE, authRequired, verifySession } from "./auth.js";
import { loadRevocations } from "./lib/sessionRevocation.js";
import { registerRoutes } from "./routes/index.js";
import { classifyExistingNotes } from "./lib/classifyExistingNotes.js";

// Endpoints reachable without a session (auth handshake + health check).
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/logout",
]);

export function buildApp(): FastifyInstance {
  if (!existsSync(config.logDir)) {
    mkdirSync(config.logDir, { recursive: true });
  }

  const app = Fastify({
    logger: {
      level: config.isProduction ? "info" : "debug",
      // Write logs to a file on the NAS volume, not stdout-only-to-cloud.
      file: join(config.logDir, "lockpad.log"),
    },
    bodyLimit: 25 * 1024 * 1024, // 25MB — accommodates bulk CSV/MD imports
    // Rate limiting is per client, and behind nginx every client looks like nginx
    // unless the forwarded-for header is honoured. See config.ts for why trusting it
    // is safe in this topology and off by default in development.
    trustProxy: config.trustProxy,
  });

  // The configuration pair that quietly undoes the app's central promise. Said at
  // startup so it is in the log, and again through /api/auth/status so the app itself
  // can say it — a warning only a NAS log file ever sees is a warning nobody reads.
  if (insecurelyExposed) app.log.warn(EXPOSURE_WARNING);

  // Revocation state is read once into memory here; the per-request check is then a
  // set lookup rather than a query. Failing to load must NOT take the server down —
  // but it must also not silently leave revoked sessions working, so it is loud.
  app.addHook("onReady", async () => {
    try {
      await loadRevocations();
    } catch (err) {
      app.log.error({ err }, "Could not load session revocations — revoked sessions may still be accepted");
    }
  });

  // Classify notes written before the app knew about languages, once, so search
  // improves for a library that already exists rather than only for what is written
  // from today.
  //
  // Deliberately NOT awaited. It reads and rewrites every note, which on a large
  // library is seconds rather than milliseconds, and holding up readiness for it would
  // leave the app unreachable for that whole time after an update — the one thing a
  // Lockpad update must never do. A library part-way through the pass is fully usable;
  // its French notes are simply still searched with English rules, exactly as they were
  // before the update.
  //
  // A failure here is logged and nothing else. The pass is idempotent and resumes on
  // the next start, and the cost of it never running at all is the search quality that
  // existed yesterday — not a reason to refuse to serve.
  app.addHook("onReady", async () => {
    void classifyExistingNotes(app.log).catch((err) => {
      app.log.error({ err }, "Could not classify existing notes by language — search keeps its previous behaviour");
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  //
  // Two limits, both per client. The global one is deliberately far above anything a
  // person can produce: 600 requests a minute is ten a second, where the heaviest
  // real burst — autosave firing every 700ms while typing, plus a list refetch — is
  // perhaps three. It is here for the runaway case (a retry loop, a stuck extension)
  // rather than for the human one, so it should never be felt.
  //
  // `/auth/login` gets its own, much tighter limit; see routes/auth.ts.
  app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    // The health check and the auth handshake are what the frontend polls to decide
    // whether it can start at all. Throttling those turns a busy moment into an app
    // that will not load.
    allowList: (request) => {
      const path = request.url.split("?")[0];
      return path === "/api/health" || path === "/api/auth/status";
    },
    // Same error shape as everything else the API returns (see errors.ts), so the
    // client has one thing to parse rather than two.
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      code: "RATE_LIMITED",
      message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });

  app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 50 },
  });

  // Auth guard: when a password is configured, every /api route needs a valid
  // session except the public handshake paths. No password → auth disabled.
  // Registered after @fastify/cookie loads so request.cookies is parsed first.
  app.register(cookie).after(() => {
    app.addHook("onRequest", async (request, reply) => {
      if (!authRequired()) return;
      const path = request.url.split("?")[0];
      if (!path.startsWith("/api/") || PUBLIC_PATHS.has(path)) return;
      if (await verifySession(request.cookies[SESSION_COOKIE])) return;
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    });
  });

  // Uniform error handler: sanitized JSON, never a stack trace to the client.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      const body: ErrorBody = {
        error: { code: error.code, message: error.message, details: error.details },
      };
      return reply.status(error.statusCode).send(body);
    }
    if (error instanceof ZodError) {
      const body: ErrorBody = {
        error: { code: "BAD_REQUEST", message: "Validation failed", details: error.flatten() },
      };
      return reply.status(400).send(body);
    }
    // Rate limiting arrives as a plain Fastify error rather than an ApiError (the
    // plugin builds it), so it is translated here instead of falling through to the
    // generic 500 — which would tell the client "something broke" when in fact the
    // server is working exactly as configured.
    const limited = error as { statusCode?: number; message?: string };
    if (limited.statusCode === 429) {
      const body: ErrorBody = {
        error: { code: "RATE_LIMITED", message: limited.message || "Too many requests. Try again later." },
      };
      return reply.status(429).send(body);
    }
    // Unexpected: log the real error server-side, return a generic message.
    request.log.error(error);
    const body: ErrorBody = {
      error: { code: "INTERNAL", message: "Internal server error" },
    };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } } satisfies ErrorBody);
  });

  // Health also reports the build's version. It is the one endpoint reachable
  // without a session or a rate limit, which makes it the honest place to ask
  // "what is actually running here?" — useful when a user reports a problem, and
  // the only way to notice a half-finished update where the frontend image moved
  // forward and the backend image did not.
  app.get("/api/health", async () => ({ status: "ok", version: config.version }));

  registerRoutes(app);

  return app;
}
