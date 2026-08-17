// Taking a session away.
//
// Sessions are stateless signed JWTs on purpose: nothing to store, nothing to clean
// up, and a restart logs nobody out. The cost of that design is that a token, once
// issued, is valid until it expires — up to thirty days. The only lever available
// before this file existed was rotating SESSION_SECRET, which is a sledgehammer: it
// invalidates every session at once, including the one belonging to the person
// pulling the lever.
//
// So: keep the stateless design, and record only the exceptions. Two of them:
//
//   • a specific token id, revoked one at a time
//   • a moment before which everything is refused, with one token exempted —
//     "sign out everywhere else"
//
// Both live in the database (they must outlive a restart, or a revoked session comes
// back to life the next time the container cycles), and both are mirrored in memory
// so the auth check on every request stays a set lookup rather than a query.
import { prisma } from "../prisma.js";

let revoked = new Set<string>();
let notBefore: Date | null = null;
let exemptJti: string | null = null;

/** Load the revocation state into memory. Called once at startup. */
export async function loadRevocations(): Promise<void> {
  const [rows, epoch] = await Promise.all([
    prisma.revokedSession.findMany({ where: { expiresAt: { gt: new Date() } }, select: { jti: true } }),
    prisma.sessionEpoch.findUnique({ where: { id: 1 } }),
  ]);
  revoked = new Set(rows.map((r) => r.jti));
  notBefore = epoch?.notBefore ?? null;
  exemptJti = epoch?.exemptJti ?? null;
  // Rows whose token has expired anyway are dead weight — the token is refused on
  // its own expiry — so startup is a natural moment to sweep them.
  await prisma.revokedSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

/** Is this token still allowed? `issuedAt` is the JWT's `iat`, in seconds. */
export function isSessionRevoked(jti: string | undefined, issuedAt: number | undefined): boolean {
  // Tokens issued before this feature existed carry no id. They are not revocable
  // individually, but the epoch still applies to them via their `iat`.
  if (jti && revoked.has(jti)) return true;
  if (notBefore && issuedAt !== undefined) {
    if (issuedAt * 1000 < notBefore.getTime() && jti !== exemptJti) return true;
  }
  return false;
}

/** Revoke one session by id. */
export async function revokeSession(jti: string, expiresAt: Date): Promise<void> {
  await prisma.revokedSession.upsert({
    where: { jti },
    create: { jti, expiresAt },
    update: { expiresAt },
  });
  revoked.add(jti);
}

/** Revoke every session except `keepJti` — the device asking for it. */
export async function revokeAllExcept(keepJti: string | null): Promise<void> {
  const now = new Date();
  await prisma.sessionEpoch.upsert({
    where: { id: 1 },
    create: { id: 1, notBefore: now, exemptJti: keepJti },
    update: { notBefore: now, exemptJti: keepJti },
  });
  notBefore = now;
  exemptJti = keepJti;
}

