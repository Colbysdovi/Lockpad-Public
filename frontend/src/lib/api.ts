// The one place the app talks to the server.
//
// Every request in Lockpad goes through here, which is what makes a handful of
// cross-cutting rules possible to state once: the session cookie always rides
// along, errors always arrive as a typed ApiError, and a lapsed session always
// lands the user back on the login screen no matter which call noticed.
//
// The base URL is RELATIVE ("/api") on purpose. Nothing is ever fetched from
// another origin, so the app works identically behind `tailscale serve`, behind
// nginx, and through the Vite dev proxy — and there is no CORS to configure and no
// third-party host that could see a request. That is part of the privacy promise,
// not just a convenience.
import { tOutsideReact } from "@/lib/i18n";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** A failed request, with the server's own error contract preserved: `code` is the
 *  machine-readable reason (e.g. "CONFLICT"), `message` is written for a human and
 *  is safe to show directly in the UI — several dialogs do exactly that. */
export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Called when any request comes back 401 — lets the auth layer drop back to the
// login screen without every caller having to handle it.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// The single request implementation everything else is a thin wrapper around.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    // Send/receive the session cookie (same-origin behind the dev proxy / nginx).
    credentials: "include",
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  // 204 No Content has no body to parse — several deletes answer this way.
  if (res.status === 204) return undefined as T;
  // Errors are JSON, but a crash upstream (a proxy, a 502 page) may not be, so the
  // content type decides how to read the body rather than assuming.
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = (body as { error?: { code: string; message: string; details?: unknown } })?.error;
    // A 401 on anything other than the auth handshake means the session lapsed.
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? tOutsideReact("error.request"), err?.details);
  }
  return body as T;
}

// The verbs. `post` allows a missing body (several actions are a bare POST), and
// `postForm` skips JSON encoding so the browser can set the multipart boundary
// itself — that is how file imports are uploaded.
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body != null ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  // PUT rather than PATCH where the request REPLACES a whole value rather than
  // amending part of one — the interface language is a single setting that is set,
  // not a record with fields to merge.
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),
};
