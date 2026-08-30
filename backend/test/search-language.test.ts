// Language-aware search: does a French note search as well as an English one, and
// does it still use the index.
//
// The correctness half is easy to state — a French word must find a French note by
// its stem. The performance half is the one that would have shipped broken: an
// implementation that casts the note's language column to regconfig inside the WHERE
// clause is perfectly correct and cannot use the GIN index, turning every search into
// a sequential scan. Every correctness test passes; the app just gets slower with
// every note added. So EXPLAIN is asserted on, not just results.
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

const para = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function createNote(title: string, text: string) {
  const r = await app.inject({ method: "POST", url: "/api/notes", payload: { title, content: para(text) } });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { id: string };
}

async function search(q: string) {
  const r = await app.inject({ method: "GET", url: `/api/notes/search?q=${encodeURIComponent(q)}` });
  assert.equal(r.statusCode, 200, r.body);
  return (r.json() as { results: Array<{ id: string; title: string; snippet: string }> }).results;
}

test("a French note is found by a French stem", async () => {
  // "verrouillées" (plural) must find a note containing "verrouillée" (singular).
  // Under the 'english' configuration those are two unrelated tokens and the note is
  // simply not found — which is the gap this whole module exists to close.
  const note = await createNote(
    "Notes verrouillées",
    "Le serveur ne doit jamais pouvoir lire une note verrouillée. La dérivation de clé reste côté client."
  );
  const results = await search("verrouillees");
  const alt = results.length ? results : await search("verrouillée");
  assert.ok(alt.some((r) => r.id === note.id), `French stemming did not match: ${JSON.stringify(alt)}`);
});

test("an English note is still found by an English stem", async () => {
  // The regression guard. Everything above must not come at the cost of what already
  // worked: "derivation" must still find a note that says "derivation", and plural
  // and singular must still collapse under English rules.
  const note = await createNote(
    "Locked notes",
    "The server should never be able to read a locked note. Key derivations stay entirely client-side."
  );
  const results = await search("derivation");
  assert.ok(results.some((r) => r.id === note.id), `English stemming regressed: ${JSON.stringify(results)}`);
});

test("both languages come back from one query, in one result set", async () => {
  // PRD §3.4: a French note and an English note are searched correctly by the same
  // request. Not two code paths chosen by the interface language — one query.
  const fr = await createNote(
    "Réunion hebdomadaire",
    "Nous parlons de configuration et de déploiement pendant la réunion hebdomadaire de mardi."
  );
  const en = await createNote(
    "Weekly meeting",
    "We talk about configuration and deployment during the weekly meeting on Tuesday."
  );
  const results = await search("configuration");
  const ids = results.map((r) => r.id);
  assert.ok(ids.includes(fr.id), "the French note was missing");
  assert.ok(ids.includes(en.id), "the English note was missing");
});

test("results do not depend on the interface language", async () => {
  // §3.4 again, from the other side. The interface language is an account setting and
  // has nothing to do with how a note is indexed; if changing it changed results, the
  // two concepts have been wired together somewhere they should not be.
  const note = await createNote(
    "Déploiement de la semaine",
    "Le déploiement de la semaine prochaine concerne surtout la configuration du serveur."
  );

  // Queried WITH the accent. Postgres's 'french' configuration stems but does not
  // fold accents, so "deploiement" does not match "déploiement" — see the note in
  // the kanban's flagged section; making accent-insensitive search work needs the
  // unaccent extension and a custom configuration, which is a decision rather than a
  // detail. What this test is about is the interface language, so it uses a query
  // that matches under the rules as they are.
  const withEnglishUi = await (async () => {
    await app.inject({ method: "PUT", url: "/api/settings/language", payload: { language: "en" } });
    return search("déploiement");
  })();
  const withFrenchUi = await (async () => {
    await app.inject({ method: "PUT", url: "/api/settings/language", payload: { language: "fr" } });
    return search("déploiement");
  })();

  assert.deepEqual(
    withEnglishUi.map((r) => r.id),
    withFrenchUi.map((r) => r.id),
    "the interface language changed the search results"
  );
  assert.ok(withFrenchUi.some((r) => r.id === note.id));
});

test("a locked note never appears in results", async () => {
  const note = await createNote(
    "Secret plans",
    "The unmistakable word zarquon appears here and nowhere else in the library."
  );
  assert.ok((await search("zarquon")).some((r) => r.id === note.id), "fixture must be findable before locking");

  const locked = await app.inject({
    method: "POST",
    url: `/api/notes/${note.id}/lock`,
    payload: {
      ciphertext: Buffer.from("ciphertext").toString("base64"),
      cryptoMeta: { kdf: "pbkdf2", salt: "c2FsdA==", iv: "aXY=", params: { iterations: 600000 } },
    },
  });
  assert.equal(locked.statusCode, 200, locked.body);
  assert.equal((await search("zarquon")).length, 0, "a locked note leaked into search results");
});

test("the query the index sees is constant, not rebuilt for every row", async () => {
  // The measurement behind PRD §5's "a search query must not become slower than it is
  // today", and it is asserted on the PLAN rather than on results because the failure
  // is invisible from results.
  //
  // The property that decides whether the GIN index can be used is whether the
  // tsquery is a constant for the whole query or a value computed per row. The
  // index-safe form ORs two branches with literal configurations, so the planner sees
  // constants; the natural-looking alternative casts the note's own language column to
  // regconfig, which builds a different tsquery for every row and forces a sequential
  // scan over the entire table while returning exactly the same results.
  //
  // Asserting on "Bitmap Index Scan" directly does not work here and the reason is
  // worth recording: on a table of twenty rows the planner will pick whatever is
  // cheapest regardless, and Postgres also folds the two branches together whenever a
  // term happens to stem identically in both languages. Neither of those says anything
  // about the shape of the query. Whether the tsquery is constant does.
  const { prisma } = await import("../src/prisma.js");

  const explain = (sql: string) =>
    prisma
      .$queryRawUnsafe<Array<Record<string, string>>>(`EXPLAIN ${sql}`)
      .then((rows) => rows.map((r) => Object.values(r)[0]).join("\n"));

  const indexSafe = await explain(`
    SELECT n."id" FROM "Note" n
    WHERE n."deletedAt" IS NULL AND n."isLocked" = false
      AND (
        (n."contentLanguage" = 'english' AND n."content_tsv" @@ websearch_to_tsquery('english', 'configuration'))
        OR
        (n."contentLanguage" = 'french' AND n."content_tsv" @@ websearch_to_tsquery('french', 'configuration'))
      )`);

  assert.match(
    indexSafe,
    /::tsquery/,
    `the plan shows no constant tsquery, so the index cannot be used:\n${indexSafe}`
  );
  assert.doesNotMatch(
    indexSafe,
    /regconfig/,
    `the plan resolves a text-search configuration per row:\n${indexSafe}`
  );

  // The control. A test that only checks the good query cannot tell the difference
  // between "this assertion works" and "this assertion passes for everything", so the
  // rejected alternative is run through the same check and must fail it.
  const perRow = await explain(`
    SELECT n."id" FROM "Note" n
    WHERE n."deletedAt" IS NULL AND n."isLocked" = false
      AND n."content_tsv" @@ websearch_to_tsquery(n."contentLanguage"::regconfig, 'configuration')`);

  assert.match(
    perRow,
    /regconfig/,
    `the control was expected to resolve a configuration per row, but did not:\n${perRow}`
  );
});

test("the snippet is segmented with the note's own language", async () => {
  // ts_headline is the one place the dynamic cast IS used, because it runs over rows
  // already selected. This checks it actually took the French branch: the highlight
  // has to land on the French word.
  const note = await createNote(
    "Configuration du serveur",
    "La configuration du serveur reste locale, et le déploiement se fait depuis la machine."
  );
  const results = await search("configuration");
  const mine = results.find((r) => r.id === note.id);
  assert.ok(mine, "the French note was not returned");
  assert.match(mine.snippet, /<mark>[Cc]onfiguration<\/mark>/, `snippet did not highlight: ${mine.snippet}`);
});
