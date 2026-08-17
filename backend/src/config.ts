// Everything the server needs to know about its environment, read once at startup.
//
// The rule here is FAIL FAST: anything genuinely required throws at import time, so
// a misconfigured server refuses to start rather than booting and then failing on
// the first request that happens to need the missing value. A server that starts is
// a server that works.
//
// Everything else has a default chosen so that `npm run dev` works with no .env at
// all, while production overrides what it needs.

// Read once here rather than inline below, so the byte limit and the megabyte
// figure quoted in error messages can never disagree.
const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB ?? 10) || 10;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Whether the frontend's published port reaches further than this machine.
//
// This value cannot be observed from inside the container — it is a docker-compose
// HOST port binding (`"${FRONTEND_BIND-127.0.0.1:}${FRONTEND_PORT}:80"`), applied by
// the Docker daemon long before any of our code runs — so compose passes it in
// explicitly (see the backend service's environment). The shapes it arrives in:
//
//   unset          → compose defaults to "127.0.0.1:" → loopback only, safe
//   "127.0.0.1:"   → loopback only, safe
//   ""             → compose binds 0.0.0.0 → every interface, exposed
//   "0.0.0.0:"     → exposed
//   "10.0.0.4:" → a specific LAN interface: still exposed (README documents this)
//
// Anything unrecognised counts as EXPOSED. The consequence of over-warning once is a
// sentence the operator reads and dismisses; the consequence of under-warning is a
// note library open to the local network, which is the whole point of the check.
export function frontendReachesBeyondLoopback(raw: string | undefined): boolean {
  if (raw === undefined) return false; // not threaded through: compose default applies
  const value = raw.trim();
  if (value === "") return true; // explicitly emptied — compose binds 0.0.0.0
  const host = value.replace(/:$/, "").replace(/^\[|\]$/g, "");
  return !(host === "127.0.0.1" || host === "localhost" || host === "::1" || host.startsWith("127."));
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  // The release this server was BUILT from — baked into the image by the
  // Dockerfile, never read from the database, so it cannot go stale relative to
  // the code actually executing. "dev" means a build from source or an untagged
  // commit; see docs/RELEASING.md.
  version: process.env.APP_VERSION?.trim() || "dev",
  port: Number(process.env.BACKEND_PORT ?? 4000),
  host: process.env.BACKEND_HOST ?? "0.0.0.0",
  logDir: process.env.LOG_DIR ?? "./logs",
  // Comma-separated allowlist. Behind `tailscale serve` this is the MagicDNS URL.
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  // App-level auth. When APP_PASSWORD is empty, auth is disabled (open) — matches
  // dev and keeps backward compatibility. SESSION_SECRET signs the session token.
  // An EMPTY password means the app is open — no login screen at all. That is a
  // legitimate configuration, not an oversight: a server already private behind a
  // tailnet or a home LAN does not need a second door. Setting APP_PASSWORD is what
  // turns authentication on.
  appPassword: process.env.APP_PASSWORD ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",
  // Where the frontend is published, and whether that is beyond this machine — the
  // dangerous half of the "LAN-exposed AND no password" pair warned about at startup.
  frontendBind: process.env.FRONTEND_BIND,
  frontendExposed: frontendReachesBeyondLoopback(process.env.FRONTEND_BIND),
  // true only when served over HTTPS (e.g. `tailscale serve`); false for plain
  // HTTP over the tailnet.
  cookieSecure: process.env.COOKIE_SECURE === "true",
  // Largest single image a note may hold, in megabytes. Ten is roomy for a
  // screenshot or a downscaled phone photo (the browser shrinks anything bigger
  // before it uploads — see frontend/src/lib/noteImages.ts) while keeping any one
  // note's row, and therefore any `pg_dump` of it, a sane size. Raise it if you are
  // storing originals; the multipart limit in app.ts is the hard ceiling above it.
  maxImageMb: MAX_IMAGE_MB,
  maxImageBytes: MAX_IMAGE_MB * 1024 * 1024,
  // Behind the shipped topology every request arrives from the nginx container, so
  // without this every client would share one rate-limit bucket — one busy tab could
  // lock out another device. Only safe BECAUSE the backend publishes no host port:
  // nothing but the frontend container can reach it, so nothing else can forge the
  // forwarded-for header. Off in development, where the browser talks to Fastify
  // directly and there is no proxy to trust.
  trustProxy: (process.env.TRUST_PROXY ?? String(process.env.NODE_ENV === "production")) === "true",
  // Rate limits. Generous by design — see app.ts for the reasoning behind the
  // numbers; these exist so an operator can loosen or tighten them without a rebuild.
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 600) || 600,
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000) || 60_000,
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10) || 10,
  loginRateLimitWindowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 15 * 60_000) || 15 * 60_000,
} as const;

// ── Startup validation ───────────────────────────────────────────────────────
//
// Same fail-fast rule as `required()` above, but conditional: SESSION_SECRET only
// matters once a password turns authentication on. Without this the server starts
// happily and then throws deep inside the first login attempt — an error that names
// the right variable but arrives at the least useful possible moment, on the one
// screen the operator cannot get past.
if (config.appPassword && !config.sessionSecret) {
  throw new Error(
    "APP_PASSWORD is set but SESSION_SECRET is empty. Sessions are signed with " +
      "SESSION_SECRET, so logging in is impossible without it. Generate one with " +
      "`openssl rand -base64 32` and set SESSION_SECRET in your .env."
  );
}

// The one configuration pair that can quietly undo the app's central promise: the
// frontend published beyond this machine AND no password to stop anyone who finds
// it. Each half is a legitimate, documented choice on its own — a tailnet-only box
// genuinely does not need a second door, and LAN access is a supported setup — so
// this warns rather than refuses. Surfaced at startup (below) and in the app itself
// (via /api/auth/status), because a log line on a headless NAS is a log line nobody
// reads.
export function detectExposure(bind: string | undefined, appPassword: string): boolean {
  return frontendReachesBeyondLoopback(bind) && appPassword === "";
}

export const insecurelyExposed = detectExposure(config.frontendBind, config.appPassword);

export const EXPOSURE_WARNING =
  "Lockpad is reachable from your local network (FRONTEND_BIND is not loopback) and " +
  "has no password set (APP_PASSWORD is empty). Anyone who can reach this machine on " +
  "the network can read and edit every unlocked note, with no login. Set APP_PASSWORD " +
  "in your .env, or set FRONTEND_BIND=127.0.0.1: to keep it on this machine.";
