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

// ── Where a duplicate lands ─────────────────────────────────────────────────
//
// A copy sorts NEXT TO its original rather than to the top of the list, and it does
// so through the timestamps alone — there is no special-casing in the list query.
// That makes it exactly the kind of behaviour that breaks silently: nothing here
// throws if the copy quietly starts stamping itself with the current time, the notes
// just stop being neighbours, and the only symptom is a user losing a copy they made
// of a note near the bottom of a long list.
test("a duplicate inherits updatedAt and sorts immediately ahead of its original", async () => {
  // Three notes, created in order, so the middle one is genuinely mid-list and a
  // copy jumping to the top would be unmistakable.
  const older = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Older" } })).json();
  await new Promise((r) => setTimeout(r, 5));
  const target = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Target" } })).json();
  await new Promise((r) => setTimeout(r, 5));
  const newest = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Newest" } })).json();

  const copy = (await app.inject({ method: "POST", url: `/api/notes/${target.id}/duplicate` })).json();
  assert.equal(copy.title, "Target (copy)");
  // The content is as old as the original's, because nobody has written a word.
  assert.equal(copy.updatedAt, target.updatedAt, "copy must inherit the original's updatedAt");
  // The ROW, however, really was created now — and that is what breaks the sort tie
  // in the copy's favour, putting it immediately ahead of the note it came from.
  assert.notEqual(copy.createdAt, target.createdAt, "copy must keep its own createdAt");

  const list = (await app.inject({ method: "GET", url: "/api/notes?limit=50" })).json();
  const order = list.notes.map((n: any) => n.id);
  assert.equal(order[order.indexOf(copy.id) + 1], target.id, "copy must sit directly before its original");
  assert.equal(order[0], newest.id, "the copy must NOT displace the most recently touched note");
  assert.ok(order.indexOf(older.id) > order.indexOf(target.id));
});

// A copy inherits the original's PINS, and lands beside it in the pinned section for
// the same reason it lands beside it in the list: a shared sort key plus a tiebreak
// that the fresher row wins. Worth its own test because the failure is invisible from
// the notes list — a copy that loses its pin does not disappear, it just quietly turns
// up somewhere else on the page, which reads as the app having moved the note.
test("a duplicate inherits its original's pins and lands beside it in the pinned section", async () => {
  const other = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Also pinned" } })).json();
  await new Promise((r) => setTimeout(r, 5));
  const target = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Pinned target" } })).json();
  await app.inject({ method: "POST", url: `/api/notes/${other.id}/pin`, payload: { scope: "all" } });
  await new Promise((r) => setTimeout(r, 5));
  await app.inject({ method: "POST", url: `/api/notes/${target.id}/pin`, payload: { scope: "all" } });

  const copy = (await app.inject({ method: "POST", url: `/api/notes/${target.id}/duplicate` })).json();

  const pins = (await app.inject({ method: "GET", url: "/api/notes/pins?scope=all" })).json();
  const order = pins.notes.map((n: any) => n.id);
  assert.ok(order.includes(copy.id), "the copy of a pinned note must itself be pinned");
  assert.equal(order[order.indexOf(copy.id) + 1], target.id, "copy must sit directly before its original");
  // Inheriting pinnedAt is what keeps the pair together: a fresh stamp would fire the
  // copy past `other` to the front of the section, away from the note it came from.
  assert.equal(order[order.length - 1], other.id, "the copy must not jump ahead of an older pin");
  // And it appears ONCE — pinned in the section, excluded from the scoped list below.
  const list = (await app.inject({ method: "GET", url: "/api/notes?limit=50&scope=all" })).json();
  assert.ok(!list.notes.some((n: any) => n.id === copy.id), "a pinned copy must not also render in the list");
});

test("a duplicate of an unpinned note is not pinned", async () => {
  const target = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Unpinned" } })).json();
  const copy = (await app.inject({ method: "POST", url: `/api/notes/${target.id}/duplicate` })).json();
  const pins = (await app.inject({ method: "GET", url: "/api/notes/pins?scope=all" })).json();
  assert.ok(!pins.notes.some((n: any) => n.id === copy.id));
});

// Pins are per-page, so "inherit the pins" means all of them, not just the scope the
// user happened to be looking at when they hit duplicate.
test("a duplicate inherits every scope the original was pinned in", async () => {
  const folder = (await app.inject({ method: "POST", url: "/api/folders", payload: { name: "Scoped" } })).json();
  const target = (
    await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Multi", folderId: folder.id } })
  ).json();
  await app.inject({ method: "POST", url: `/api/notes/${target.id}/pin`, payload: { scope: "all" } });
  await app.inject({ method: "POST", url: `/api/notes/${target.id}/pin`, payload: { scope: `folder:${folder.id}` } });

  const copy = (await app.inject({ method: "POST", url: `/api/notes/${target.id}/duplicate` })).json();

  for (const scope of ["all", `folder:${folder.id}`]) {
    const pins = (await app.inject({ method: "GET", url: `/api/notes/pins?scope=${scope}` })).json();
    assert.ok(pins.notes.some((n: any) => n.id === copy.id), `copy must be pinned in ${scope}`);
  }
});

test("editing a duplicate lets it rise to the top like any other note", async () => {
  const target = (await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Source" } })).json();
  await new Promise((r) => setTimeout(r, 5));
  await app.inject({ method: "POST", url: "/api/notes", payload: { title: "Something newer" } });
  const copy = (await app.inject({ method: "POST", url: `/api/notes/${target.id}/duplicate` })).json();

  await new Promise((r) => setTimeout(r, 5));
  await app.inject({ method: "PATCH", url: `/api/notes/${copy.id}`, payload: { content: doc("now I have edited it") } });

  const list = (await app.inject({ method: "GET", url: "/api/notes?limit=50" })).json();
  assert.equal(list.notes[0].id, copy.id, "an edited copy is the most recently touched note and sorts first");
});
