// Per-note language detection, and the ordering guarantee around it.
//
// Two separate things are under test and they fail in different ways.
//
// The DETECTOR is ordinary logic: given text, does it answer correctly, and does it
// decline where the spike said it should. Those tests are cheap and run without a
// database.
//
// The WIRING is the part that matters. The PRD's reliability requirement is that a
// note's language and its search index can never disagree — and the failure mode is
// not an error, it is silently wrong search results. So the tests below check the
// language after every kind of write the app can make: create, edit, title-only edit,
// duplicate, and unlock. Any write that stores text without storing the language it
// was detected from would leave the two describing different versions of the note.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { startTestDb, type TestDb } from "./helpers/db.js";
import { detectNoteLanguage, MIN_DETECTABLE_CHARS, FALLBACK_CONFIG } from "../src/lib/language.js";

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

const para = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const FRENCH =
  "Le serveur ne doit jamais pouvoir lire une note verrouillée. La dérivation de clé reste côté client.";
const ENGLISH =
  "The server should never be able to read a locked note. Key derivation stays entirely client-side.";

async function createNote(body: Record<string, unknown>) {
  const r = await app.inject({ method: "POST", url: "/api/notes", payload: body });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { id: string; title: string };
}

async function languageOf(id: string): Promise<string> {
  const { prisma } = await import("../src/prisma.js");
  const row = await prisma.note.findUnique({ where: { id }, select: { contentLanguage: true } });
  return row!.contentLanguage;
}

// ── The detector itself ──────────────────────────────────────────────────────

test("detects the language of ordinary note text", () => {
  assert.equal(detectNoteLanguage({ title: "", content: para(FRENCH) }), "french");
  assert.equal(detectNoteLanguage({ title: "", content: para(ENGLISH) }), "english");
  assert.equal(detectNoteLanguage({ title: "Réunion d'équipe hebdomadaire", content: para("") }), "french");
});

test("declines below the measured threshold rather than guessing", () => {
  // The spike found franc classifies "Réunion mardi" — thirteen characters,
  // unambiguously French — as English. The guard is what makes that impossible, and
  // this test is the guard's reason for existing.
  assert.ok("Réunion mardi".length < MIN_DETECTABLE_CHARS);
  assert.equal(detectNoteLanguage({ title: "Réunion mardi", content: para("") }), FALLBACK_CONFIG);
  assert.equal(detectNoteLanguage({ title: "TODO", content: para("") }), FALLBACK_CONFIG);
  assert.equal(detectNoteLanguage({ title: "", content: para("") }), FALLBACK_CONFIG);
});

test("a locked note is never classified", () => {
  // The server holds only ciphertext for these. Passing one to detection would be a
  // bug rather than merely wasteful, so the guard answers before looking at anything.
  assert.equal(detectNoteLanguage({ title: FRENCH, content: para(FRENCH), isLocked: true }), FALLBACK_CONFIG);
});

test("title and body are classified together, not separately", () => {
  // A French title on an English body, where neither alone is long enough to
  // classify. Detection reads the same text the search index is built from, which is
  // both — deriving them differently is how the two could ever disagree.
  const combined = detectNoteLanguage({ title: "Notes", content: para(FRENCH) });
  assert.equal(combined, "french");
});

// ── The wiring ───────────────────────────────────────────────────────────────

test("a note is classified when it is created", async () => {
  const fr = await createNote({ title: "Réunion", content: para(FRENCH) });
  const en = await createNote({ title: "Meeting", content: para(ENGLISH) });
  assert.equal(await languageOf(fr.id), "french");
  assert.equal(await languageOf(en.id), "english");
});

test("editing a note from one language into the other moves its language", async () => {
  // PRD §7: the determination is re-evaluated whenever content changes, not frozen
  // at creation. Tested in BOTH directions, because a one-way test passes against an
  // implementation that only ever upgrades to French.
  const note = await createNote({ title: "Meeting", content: para(ENGLISH) });
  assert.equal(await languageOf(note.id), "english");

  await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { content: para(FRENCH) } });
  assert.equal(await languageOf(note.id), "french", "an edit into French must re-index as French");

  await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { content: para(ENGLISH) } });
  assert.equal(await languageOf(note.id), "english", "and back again");
});

test("a title-only edit re-classifies too", async () => {
  // The case a content-only check would miss: an unclassifiable note becoming
  // classifiable because it was renamed.
  const note = await createNote({ title: "Notes", content: para("") });
  assert.equal(await languageOf(note.id), FALLBACK_CONFIG);

  await app.inject({
    method: "PATCH",
    url: `/api/notes/${note.id}`,
    payload: { title: "Réunion d'équipe hebdomadaire du mardi matin" },
  });
  assert.equal(await languageOf(note.id), "french");
});

test("an edit that touches neither title nor content leaves the language alone", async () => {
  const note = await createNote({ title: "Réunion", content: para(FRENCH) });
  await app.inject({ method: "PATCH", url: `/api/notes/${note.id}`, payload: { color: "blue" } });
  assert.equal(await languageOf(note.id), "french");
});

test("a duplicate carries the right language", async () => {
  const note = await createNote({ title: "Réunion", content: para(FRENCH) });
  const r = await app.inject({ method: "POST", url: `/api/notes/${note.id}/duplicate` });
  assert.equal(r.statusCode, 201, r.body);
  const copy = r.json() as { id: string };
  assert.equal(await languageOf(copy.id), "french");
});

test("unlocking re-classifies, because the plaintext is back", async () => {
  const note = await createNote({ title: "Meeting", content: para(ENGLISH) });

  const locked = await app.inject({
    method: "POST",
    url: `/api/notes/${note.id}/lock`,
    payload: {
      ciphertext: Buffer.from("not really encrypted").toString("base64"),
      cryptoMeta: { kdf: "pbkdf2", salt: "c2FsdA==", iv: "aXY=", params: { iterations: 600000 } },
    },
  });
  assert.equal(locked.statusCode, 200, locked.body);

  // Unlock with FRENCH content — the note went in English and comes back French,
  // which is what a real unlock-then-rewrite looks like from the server's side.
  const unlocked = await app.inject({
    method: "POST",
    url: `/api/notes/${note.id}/unlock`,
    payload: { content: para(FRENCH) },
  });
  assert.equal(unlocked.statusCode, 200, unlocked.body);
  assert.equal(
    await languageOf(note.id),
    "french",
    "left until the next edit, an unlocked French note would be indexed as English"
  );
});

test("the column refuses a language the app cannot index with", async () => {
  // The database is the last line, not the only one. A restored backup from a future
  // version, or a stray migration, must not be able to put an unknown configuration
  // in this column — the generated tsvector would then take its ELSE branch and index
  // French text with English rules, which is wrong results and no error.
  const { prisma } = await import("../src/prisma.js");
  const note = await createNote({ title: "Meeting", content: para(ENGLISH) });
  await assert.rejects(
    () => prisma.$executeRaw`UPDATE "Note" SET "contentLanguage" = 'klingon' WHERE id = ${note.id}`,
    /check constraint|violates/i
  );
});

// ── The one-time pass over notes that predate detection ─────────────────────

test("existing notes are reclassified and reindexed by the startup pass", async () => {
  // PRD §3.4: "existing notes, not just newly created ones, are brought up to this
  // standard". Simulated the way an upgrade actually looks — a French note sitting in
  // the database with the 'english' the migration gave it, which is what every note
  // written before this feature has.
  const { prisma } = await import("../src/prisma.js");
  const { classifyExistingNotes } = await import("../src/lib/classifyExistingNotes.js");

  const note = await createNote({
    title: "Sauvegarde hebdomadaire",
    content: para(
      "La sauvegarde hebdomadaire du serveur se déclenche automatiquement le dimanche soir, sans intervention."
    ),
  });
  // Put it back into the pre-upgrade state, bypassing the route so no detection runs.
  await prisma.note.update({ where: { id: note.id }, data: { contentLanguage: "english" } });
  await prisma.appState.upsert({
    where: { id: 1 },
    create: { id: 1, notesClassifiedAt: null },
    update: { notesClassifiedAt: null },
  });

  // "déclenchement" is chosen, not picked at random: it matches the note's
  // "déclenche" under French stemming and does NOT match under English. Most French
  // words match either way — "sauvegardes", "serveurs", "dimanches" all do — so a
  // query chosen casually would pass against a note still indexed as English and
  // would prove nothing at all. Verified against both configurations directly before
  // being written down here.
  const stemmedFrench = async () => {
    const r = await app.inject({ method: "GET", url: "/api/notes/search?q=" + encodeURIComponent("déclenchement") });
    return (r.json() as { results: Array<{ id: string }> }).results.map((x) => x.id);
  };

  // Before: indexed with English rules, so a French stem does not reach it. This is
  // the gap, demonstrated rather than asserted about.
  assert.ok(!(await stemmedFrench()).includes(note.id), "fixture should start unfindable by a French stem");

  await classifyExistingNotes(app.log);

  assert.equal(await languageOf(note.id), "french", "the pass did not reclassify the note");
  assert.ok(
    (await stemmedFrench()).includes(note.id),
    "reclassifying did not regenerate the search index — the two have come apart"
  );
});

test("the classification pass never runs twice", async () => {
  // It rewrites every note, so a pass that repeated on every restart would be a
  // recurring cost for no benefit — and would fight with a user who is editing.
  const { prisma } = await import("../src/prisma.js");
  const { classifyExistingNotes } = await import("../src/lib/classifyExistingNotes.js");

  const stampedAt = (await prisma.appState.findUnique({ where: { id: 1 } }))?.notesClassifiedAt;
  assert.ok(stampedAt, "the previous test should have stamped completion");

  await classifyExistingNotes(app.log);
  const after = (await prisma.appState.findUnique({ where: { id: 1 } }))?.notesClassifiedAt;
  assert.equal(after?.toISOString(), stampedAt.toISOString(), "the pass ran a second time");
});

test("the pass leaves locked notes alone", async () => {
  const { prisma } = await import("../src/prisma.js");
  const { classifyExistingNotes } = await import("../src/lib/classifyExistingNotes.js");

  const note = await createNote({ title: "Journal", content: para(FRENCH) });
  await app.inject({
    method: "POST",
    url: `/api/notes/${note.id}/lock`,
    payload: {
      ciphertext: Buffer.from("ciphertext").toString("base64"),
      cryptoMeta: { kdf: "pbkdf2", salt: "c2FsdA==", iv: "aXY=", params: { iterations: 600000 } },
    },
  });
  await prisma.note.update({ where: { id: note.id }, data: { contentLanguage: "english" } });
  await prisma.appState.update({ where: { id: 1 }, data: { notesClassifiedAt: null } });

  await classifyExistingNotes(app.log);

  assert.equal(
    await languageOf(note.id),
    "english",
    "a locked note was classified — the server has only ciphertext for it"
  );
});
