// Who is allowed to reach the API.
//
// Lockpad is single-user, so there are no accounts, no user table and no roles:
// one password for the whole app, configured as an environment variable. The
// session token asserts exactly one thing — "the owner is logged in" — and carries
// no claims beyond its expiry.
//
// The token is a signed JWT held in an httpOnly cookie, which means the server
// stores NO session state: nothing to persist, nothing to clean up, and a restart
// does not log anyone out. Signing it is what stops a token being forged; httpOnly
// is what stops any script on the page from reading it.
//
// NOTE this is entirely separate from a note's lock. This password controls access
// to the app. A note's passphrase encrypts its contents in the browser and never
// reaches this server at all — so getting past this layer still does not reveal a
// locked note.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";
import { isSessionRevoked } from "./lib/sessionRevocation.js";

export const SESSION_COOKIE = "lockpad_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days (for "remember me")

// No password configured means no authentication — see config.ts for why that is a
// supported setup rather than a mistake.
export function authRequired(): boolean {
  return config.appPassword.length > 0;
}

function secret(): Uint8Array {
  if (!config.sessionSecret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(config.sessionSecret);
}

// Compared in constant time. A naive === returns as soon as two bytes differ, and
// the time it takes therefore leaks how much of a guess was correct — enough, over
// many attempts, to recover the password one character at a time. timingSafeEqual
// always looks at every byte. The length check above is a necessary exception (it
// throws on mismatched lengths) and leaks only the length, which is not useful.
export function checkPassword(input: string): boolean {
  const expected = config.appPassword;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Every session now carries an id (`jti`). It is the only thing that makes a single
// session revocable: without one, "take that device away" can only be expressed as
// "change the secret", which takes every device away including this one.
export async function signSession(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export interface SessionInfo {
  id?: string;
  issuedAt?: number;
  expiresAt?: number;
}

/** Read a token's claims without deciding anything about them. */
export async function readSession(token?: string | null): Promise<SessionInfo | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: payload.jti, issuedAt: payload.iat, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

export async function verifySession(token?: string | null): Promise<boolean> {
  const session = await readSession(token);
  if (!session) return false;
  // A signature that checks out is necessary but no longer sufficient: the session
  // may since have been taken away, either by id or by the "everywhere else" sweep.
  return !isSessionRevoked(session.id, session.issuedAt);
}
