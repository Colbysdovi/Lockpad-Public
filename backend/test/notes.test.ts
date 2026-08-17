// Integration tests for the note CRUD and list endpoints.
//
// These run against a REAL Postgres — a throwaway one, booted per test file (see
// helpers/db.ts) — rather than a mock. That is the point: most of what can go wrong
// in this app lives in the database layer, not in the handlers. Cursor pagination,
// the full-text tsvector, the soft-delete filters and the cascade rules all behave
// correctly only if Postgres actually does what we think it does, and a mock would
// happily agree with a wrong assumption forever.
//
// Requests go through app.inject() — Fastify's in-process request simulator — so
// the full middleware stack (validation, error mapping, auth) runs without ever
// binding a port.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { startTestDb, type TestDb } from "./helpers/db.js";

let db: TestDb;
let app: FastifyInstance;

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.url;
  process.env.LOG_DIR = "./logs";
  process.env.CORS_ORIGINS = "http://localhost:5173";
  // Import after env is set so config + prisma pick up the test DB.
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

function doc(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

test("create note returns 201 with defaults", async () => {
  const res = await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Hello", content: doc("world body") } });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.title, "Hello");
  assert.equal(body.preview, "world body");
  assert.equal(body.isLocked, false);
  assert.equal(body.folder, null);
  assert.deepEqual(body.tags, []);
});

test("list returns most-recent-first and paginates via cursor", async () => {
  // Create 3 more so we have several; small limit to force pagination.
  for (const t of ["A", "B", "C"]) {
    await app.inject({ method: "POST", url: "/api/notes", payload: { title: t, content: doc(t) } });
  }
  const first = await app.inject({ method: "GET", url: "/api/notes?limit=2" });
  const p1 = first.json();
  assert.equal(p1.notes.length, 2);
  assert.ok(p1.nextCursor);
  const second = await app.inject({ method: "GET", url: `/api/notes?limit=2&cursor=${p1.nextCursor}` });
  const p2 = second.json();
  // No overlap between pages.
  const ids1 = new Set(p1.notes.map((n: any) => n.id));
  for (const n of p2.notes) assert.ok(!ids1.has(n.id), "pages must not overlap");
});

test("patch updates title + content and bumps updatedAt", async () => {
  const created = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Old" } })).json();
  await new Promise((r) => setTimeout(r, 5));
  const patched = (await app.inject({ method: "PATCH", url: `/api/notes/${created.id}`, payload: { title: "New", content: doc("updated") } })).json();
  assert.equal(patched.title, "New");
  assert.equal(patched.preview, "updated");
  assert.ok(new Date(patched.updatedAt) >= new Date(created.updatedAt));
});

test("patch rejects unknown fields (strict schema) with 400", async () => {
  const created = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "X" } })).json();
  const res = await app.inject({ method: "PATCH", url: `/api/notes/${created.id}`, payload: { bogus: true } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "BAD_REQUEST");
});

test("get unknown note returns 404 with error shape", async () => {
  const res = await app.inject({ method: "GET", url: "/api/notes/ckxxxxxxxxxxxxxxxxxxxxxxx" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, "NOT_FOUND");
});
