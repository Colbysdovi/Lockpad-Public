// The upgrade-safety branch of the onboarding migration, tested the only way that
// actually proves anything: by applying the migration to a database that already
// holds notes.
//
// This is the highest-stakes behaviour in the whole feature. Every other bug here
// costs someone a wasted click. THIS one, wrong, means a person upgrades their
// self-hosted notes app and finds a welcome wizard and three example notes sitting
// in a library they have been keeping for a year — content they never asked for,
// mixed in with their own writing, on the one class of change that must never
// surprise anybody.
//
// The other tests exercise the API against a schema that already has the migration
// applied in its resting state. That is a different thing, and it cannot fail the
// way this can. Here the migration is un-applied and re-applied against real rows,
// so both branches of the rule are exercised as SQL, which is where they live.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startTestDb, type TestDb } from "./helpers/db.js";
import pkg from "pg";

const { Client } = pkg;

const here = fileURLToPath(new URL(".", import.meta.url));
const MIGRATION = readFileSync(
  join(here, "../prisma/migrations/20260815210000_onboarding_state/migration.sql"),
  "utf8",
);

let db: TestDb;
let sql: InstanceType<typeof Client>;

before(async () => {
  db = await startTestDb();
  sql = new Client({ connectionString: db.url });
  await sql.connect();
});

after(async () => {
  await sql?.end();
  await db?.stop();
});

/** Put the database back to how it looked the instant before this feature existed. */
async function rewindToPreMigration() {
  await sql.query('DROP TABLE IF EXISTS "AppState"');
}

async function appState() {
  const r = await sql.query('SELECT "onboardedAt", "seededAt" FROM "AppState" WHERE id = 1');
  return r.rows[0] as { onboardedAt: Date | null; seededAt: Date | null } | undefined;
}

test("a populated library is marked onboarded AND seeded, so it sees nothing", async () => {
  await rewindToPreMigration();
  await sql.query(
    `INSERT INTO "Note" (id, title, content, "createdAt", "updatedAt")
     VALUES ('mig-note-1', 'A note from before', '{}'::jsonb, NOW() - INTERVAL '400 days', NOW()),
            ('mig-note-2', 'Another one',       '{}'::jsonb, NOW() - INTERVAL '200 days', NOW())`,
  );

  await sql.query(MIGRATION);

  const row = await appState();
  assert.ok(row, "the migration must create the singleton row");
  assert.ok(row.onboardedAt, "an existing library must be stamped onboarded");
  assert.ok(
    row.seededAt,
    "and stamped seeded — this is what stops starter notes ever reaching a real library",
  );

  // Stamped from the oldest note, not from migration time, so the timestamp reads as
  // "this library has existed since then" rather than implying a wizard ran today.
  const ageDays = (Date.now() - row.onboardedAt.getTime()) / 86_400_000;
  assert.ok(ageDays > 390, `expected the stamp to track the oldest note, got ${Math.round(ageDays)} days`);
});

test("a trashed-only library still counts as populated", async () => {
  // Someone whose notes are all in the trash has a real library with a bad week, not
  // a fresh install. Seeding into it would be just as wrong.
  await rewindToPreMigration();
  await sql.query('DELETE FROM "Note"');
  await sql.query(
    `INSERT INTO "Note" (id, title, content, "createdAt", "updatedAt", "deletedAt")
     VALUES ('mig-note-3', 'In the trash', '{}'::jsonb, NOW() - INTERVAL '30 days', NOW(), NOW())`,
  );

  await sql.query(MIGRATION);

  const row = await appState();
  assert.ok(row?.onboardedAt, "a library whose notes are all trashed is still not new");
});

test("a genuinely empty database is left un-onboarded, so the wizard can run", async () => {
  await rewindToPreMigration();
  await sql.query('DELETE FROM "Note"');

  await sql.query(MIGRATION);

  const row = await appState();
  assert.ok(row, "the row must exist either way");
  assert.equal(row.onboardedAt, null, "a fresh install must be owed the wizard");
  assert.equal(row.seededAt, null, "and owed its starter notes");
});
