// First-run onboarding: the flag, the seeding, and the two guarantees that matter.
//
// The interesting behaviour here is not "does the endpoint return JSON" — it is
// whether the two promises this feature makes actually hold under abuse:
//
//   1. Seeding happens EXACTLY once. It fires when the flow starts, while the flag
//      that ends the flow is written when the user finishes — so anything that can
//      re-enter that window (a reload, a second tab, an impatient double-click) is a
//      chance to write starter notes into a library twice.
//
//   2. Completing is idempotent and keeps the FIRST timestamp. "When did this
//      instance stop being new" should not be rewritten by a replay from Settings.
//
// The upgrade-safety branch — an existing library being stamped onboarded by the
// migration — is not exercised here, because it happens in SQL at migration time
// against a database that already has notes, which is a different setup than this
// harness builds. It is verified separately against a restored backup.
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

const get = async (url: string) => {
  const r = await app.inject({ method: "GET", url });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
};
const post = async (url: string) => {
  const r = await app.inject({ method: "POST", url });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
};
const noteCount = async () => (await get("/api/notes?filter=active")).body.notes as unknown[];

test("a fresh instance is neither onboarded nor seeded", async () => {
  const { status, body } = await get("/api/onboarding");
  assert.equal(status, 200);
  assert.equal(body.onboarded, false);
  assert.equal(body.onboardedAt, null);
  assert.equal(body.seeded, false);
});

test("seeding creates the starter notes, with the organised one carrying a folder and a tag", async () => {
  const { body } = await post("/api/onboarding/seed");
  assert.equal(body.created, 3);
  assert.equal(body.seeded, true);

  const notes = (await noteCount()) as { folder: unknown; tags: unknown[]; isLocked: boolean }[];
  assert.equal(notes.length, 3);

  // Step 2 of the wizard points at a real organised example, so at least one starter
  // note must actually have both. Without this the step falls back to describing
  // folders and tags in the abstract, which is the thing it exists not to do.
  assert.ok(
    notes.some((n) => n.folder && n.tags.length > 0),
    "expected a starter note with both a folder and a tag",
  );

  // Never locked: Lockpad's encryption has no passphrase recovery, so a locked
  // starter note would be permanently unreadable in a brand-new library.
  assert.ok(notes.every((n) => !n.isLocked), "starter notes must never be locked");
});

test("seeding is exactly once, no matter how many times it is called", async () => {
  for (let i = 0; i < 4; i++) await post("/api/onboarding/seed");
  assert.equal((await noteCount()).length, 3, "repeated seeding must not add notes");
});

test("concurrent seed calls cannot race extra notes into the library", async () => {
  // The realistic version of the double-submit: several tabs, or strict mode, or a
  // user hammering reload. The check-and-write is one transaction precisely so this
  // cannot interleave into six notes.
  await Promise.all([1, 2, 3, 4, 5].map(() => post("/api/onboarding/seed")));
  assert.equal((await noteCount()).length, 3);
});

test("completing marks the instance onboarded", async () => {
  const before = await get("/api/onboarding");
  assert.equal(before.body.onboarded, false);

  const { body } = await post("/api/onboarding/complete");
  assert.equal(body.onboarded, true);
  assert.ok(body.onboardedAt);
});

test("completing twice keeps the first timestamp", async () => {
  const first = (await get("/api/onboarding")).body.onboardedAt;
  await post("/api/onboarding/complete");
  const second = (await get("/api/onboarding")).body.onboardedAt;
  assert.equal(second, first, "a replay must not rewrite when the instance stopped being new");
});

test("an emptied library does not become new again", async () => {
  // The trigger is the flag and nothing else. Someone who clears out their notes on
  // a slow afternoon must not be greeted with a welcome wizard — and must certainly
  // not have three example notes written into the library they just emptied.
  const notes = (await noteCount()) as { id: string }[];
  for (const n of notes) await app.inject({ method: "DELETE", url: `/api/notes/${n.id}` });
  assert.equal((await noteCount()).length, 0);

  const { body } = await get("/api/onboarding");
  assert.equal(body.onboarded, true, "deleting every note must not re-arm onboarding");
});

test("the dev reset re-arms the wizard without un-seeding", async () => {
  // NODE_ENV is not production in tests, so the route is live here. Clearing the
  // seeded marker as well would mean the next load wrote a SECOND set of starter
  // notes on top of the ones already sitting in the library.
  const { body } = await post("/api/onboarding/reset");
  assert.equal(body.onboarded, false, "reset should re-arm the wizard");
  assert.equal(body.seeded, true, "reset must NOT un-seed — that is what causes duplicates");
});
