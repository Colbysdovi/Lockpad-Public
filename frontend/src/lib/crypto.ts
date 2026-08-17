// Client-side end-to-end encryption for locked notes (spec §3.9).
//
// Design: the passphrase never leaves the browser. We derive a 256-bit AES-GCM
// key from it with PBKDF2 (SHA-256, 600k iterations — OWASP 2023 guidance) via
// native WebCrypto, encrypt the note's TipTap JSON, and send ONLY ciphertext +
// KDF params (salt/iv) to the server. Derived keys live only in memory for the
// session (see keyStore below) and are never written to localStorage.
//
// NOTE (deviation): the spec prefers Argon2. We use PBKDF2 because it's provided
// natively by WebCrypto (no WASM), is a vetted primitive, and avoids the argon2
// WASM bundling fragility. The cryptoMeta.kdf field records "pbkdf2" so a future
// Argon2 upgrade can coexist. See build-log.md.

const PBKDF2_ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface CryptoMeta {
  kdf: "pbkdf2";
  salt: string; // base64
  iv: string; // base64
  params: { iterations: number; hash: "SHA-256" };
}

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // non-exportable
    ["encrypt", "decrypt"]
  );
}

// Encrypt a note document. Returns base64 ciphertext + the metadata the client
// needs to decrypt it later.
export async function encryptNote(doc: unknown, passphrase: string): Promise<{ ciphertext: string; cryptoMeta: CryptoMeta }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = enc.encode(JSON.stringify(doc));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext);
  return {
    ciphertext: toB64(cipher),
    cryptoMeta: { kdf: "pbkdf2", salt: toB64(salt), iv: toB64(iv), params: { iterations: PBKDF2_ITERATIONS, hash: "SHA-256" } },
  };
}

// Decrypt. Throws if the passphrase is wrong (AES-GCM auth tag fails).
export async function decryptNote(ciphertext: string, passphrase: string, meta: CryptoMeta): Promise<unknown> {
  const salt = fromB64(meta.salt);
  const iv = fromB64(meta.iv);
  const key = await deriveKey(passphrase, salt, meta.params.iterations);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, fromB64(ciphertext) as BufferSource);
  return JSON.parse(dec.decode(plain));
}

// In-memory session store of decrypted note docs. Cleared on reload; never
// persisted. Keyed by note id.
const sessionUnlocked = new Map<string, unknown>();
export const keyStore = {
  set: (noteId: string, doc: unknown) => sessionUnlocked.set(noteId, doc),
  get: (noteId: string) => sessionUnlocked.get(noteId),
  has: (noteId: string) => sessionUnlocked.has(noteId),
  clear: (noteId: string) => sessionUnlocked.delete(noteId),
};
