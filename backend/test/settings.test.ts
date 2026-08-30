// The account-level interface language.
//
// Four things are worth testing here and only one of them is the round-trip.
//
//   1. A fresh install answers NULL, not "en". That distinction is the whole of the
//      first-run behaviour: NULL is what permits the client to read the browser's
//      preferred language exactly once. A default of "en" would look harmless and
//      would silently mean no install ever auto-detects.
//
//   2. An unsupported locale is REFUSED rather than stored. The column is plain
//      TEXT, so an unchecked write would persist a language with no catalogue — and
//      the user would then have to fix it from an interface they can no longer read.
//
//   3. Writing the language leaves onboardedAt and seededAt alone. They live on the
//      same single row, and a settings write that disturbed them could make an
//      existing library look new, which is the one failure this app must never have.
//
//   4. It is idempotent, because Settings will happily send the same value twice.
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

const getLanguage = async () => {
  const r = await app.inject({ method: "GET", url: "/api/settings/language" });
  return { status: r.statusCode, body: r.json() as { language: string | null } };
};

const putLanguage = async (payload: Record<string, unknown>) => {
  const r = await app.inject({ method: "PUT", url: "/api/settings/language", payload });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
};

test("a fresh install has never chosen a language", async () => {
  const { status, body } = await getLanguage();
  assert.equal(status, 200);
  assert.equal(
    body.language,
    null,
    "null is what lets the client auto-detect once; a default would disable first-run detection entirely"
  );
});

test("a supported language round-trips", async () => {
  const written = await putLanguage({ language: "fr" });
  assert.equal(written.status, 200);
  assert.equal(written.body.language, "fr");

  const read = await getLanguage();
  assert.equal(read.body.language, "fr", "the stored value must survive a separate request");
});

test("writing the same language twice is idempotent", async () => {
  await putLanguage({ language: "fr" });
  const second = await putLanguage({ language: "fr" });
  assert.equal(second.status, 200);
  assert.equal(second.body.language, "fr");
});

test("an unsupported language is refused, not stored", async () => {
  await putLanguage({ language: "en" });

  for (const bad of [{ language: "de" }, { language: "" }, { language: "EN" }, { language: 42 }, {}]) {
    const rejected = await putLanguage(bad);
    assert.equal(rejected.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }

  const after = await getLanguage();
  assert.equal(after.body.language, "en", "a rejected write must not disturb the stored value");
});

test("changing the language leaves the onboarding state untouched", async () => {
  const { prisma } = await import("../src/prisma.js");

  // Put the row into a state that MEANS something: this instance has been welcomed
  // and seeded. If a language write were to clear either, an existing library would
  // look brand new on its next boot and could be seeded a second time.
  const onboardedAt = new Date("2026-01-02T03:04:05.000Z");
  const seededAt = new Date("2026-01-02T03:04:06.000Z");
  await prisma.appState.upsert({
    where: { id: 1 },
    create: { id: 1, onboardedAt, seededAt },
    update: { onboardedAt, seededAt },
  });

  await putLanguage({ language: "fr" });

  const row = await prisma.appState.findUnique({ where: { id: 1 } });
  assert.equal(row?.uiLanguage, "fr");
  assert.equal(row?.onboardedAt?.toISOString(), onboardedAt.toISOString());
  assert.equal(row?.seededAt?.toISOString(), seededAt.toISOString());
});

test("the onboarding endpoint still reports the same state after a language change", async () => {
  // The complement of the test above, from the outside: not just "the columns are
  // intact" but "the endpoint that reads them still says what it said".
  const before = await app.inject({ method: "GET", url: "/api/onboarding" });
  await putLanguage({ language: "en" });
  const after = await app.inject({ method: "GET", url: "/api/onboarding" });
  assert.deepEqual(after.json(), before.json());
});
