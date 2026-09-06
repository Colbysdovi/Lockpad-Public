// How fast is search, at the size a real personal library actually reaches?
//
// PRD §5 asks for results "well within the range a user would notice at normal typing
// speed, roughly under 150ms, for a personal library of up to a few thousand notes and a
// few dozen folders/tags", and the research pass explicitly could not answer it — no
// dataset of that shape existed to measure. This script builds one and measures.
//
// It is NOT a test. It boots a throwaway Postgres, seeds it, and prints numbers; a
// timing assertion in the test suite would fail on a loaded machine and tell you nothing
// about the code. Run it when the query changes:
//
//     cd backend && npx tsx test/search-benchmark.mts
//
// Everything it touches is discarded on exit.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { startTestDb } from "./helpers/db.js";

const NOTES = 3000;
const FOLDERS = 40;
const TAGS = 40;
const RUNS = 25;

// Ordinary prose, so the tsvector has a realistic vocabulary rather than one repeated
// word. The query terms below are planted at a known frequency.
const WORDS = `the quick brown fox jumps over lazy dog while server keeps writing notes
about deployment configuration backup restore migration schema index query planner cache
invalidation latency throughput budget forecast invoice receipt meeting agenda decision
tradeoff sketch prototype interview onboarding retention churn`.split(/\s+/);

const rand = (n: number) => Math.floor(Math.random() * n);
const sentence = (n: number) => Array.from({ length: n }, () => WORDS[rand(WORDS.length)]).join(" ");

const db = await startTestDb();
process.env.DATABASE_URL = db.url;
process.env.LOG_DIR = "./logs";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { buildApp } = await import("../src/app.js");
const { prisma } = await import("../src/prisma.js");
const app = buildApp();
await app.ready();

// ── Seed ──────────────────────────────────────────────────────────────────────
// Written through Prisma directly rather than the API: 3,000 HTTP round trips would
// measure Fastify's request handling, and the generated tsvector column is filled by
// Postgres on write either way, so the rows are identical to ones the app made.
console.log(`seeding ${NOTES} notes, ${FOLDERS} folders, ${TAGS} tags…`);
const t0 = performance.now();

const folders = await Promise.all(
  Array.from({ length: FOLDERS }, (_, i) =>
    prisma.folder.create({ data: { name: i === 0 ? "Ledgerwick" : `Folder ${i}` }, select: { id: true } })
  )
);
const tags = await Promise.all(
  Array.from({ length: TAGS }, (_, i) =>
    prisma.tag.create({ data: { name: i === 0 ? "phlogiston" : `tag-${i}` }, select: { id: true } })
  )
);

for (let batch = 0; batch < NOTES; batch += 250) {
  await prisma.$transaction(
    Array.from({ length: Math.min(250, NOTES - batch) }, (_, k) => {
      const i = batch + k;
      // One note in fifty mentions the content query term, so it behaves like a real
      // search: a handful of hits in a large table, not half the library.
      const body = i % 50 === 0 ? `${sentence(60)} zarquon ${sentence(60)}` : sentence(120);
      return prisma.note.create({
        data: {
          title: `Note ${i} ${WORDS[rand(WORDS.length)]}`,
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] },
          // Folder 0 ("Ledgerwick") holds 1 in 60, the rest spread over the others.
          folderId: i % 60 === 0 ? folders[0].id : folders[1 + (i % (FOLDERS - 1))].id,
        },
        select: { id: true },
      });
    })
  );
}

// Tag 0 ("phlogiston") on 1 in 60 notes; every note gets one other tag.
const ids = await prisma.note.findMany({ select: { id: true } });
for (let batch = 0; batch < ids.length; batch += 500) {
  await prisma.noteTag.createMany({
    data: ids.slice(batch, batch + 500).map((n, k) => ({
      noteId: n.id,
      tagId: (batch + k) % 60 === 0 ? tags[0].id : tags[1 + ((batch + k) % (TAGS - 1))].id,
    })),
  });
}

// Without ANALYZE the planner is working from defaults and any plan printed below is
// about a table Postgres thinks is empty.
// One statement per call — a prepared statement cannot carry several.
for (const table of ["Note", "NoteTag", "Folder", "Tag"]) {
  await prisma.$executeRawUnsafe(`ANALYZE "${table}"`);
}
console.log(`seeded in ${Math.round(performance.now() - t0)}ms\n`);

// ── Measure ───────────────────────────────────────────────────────────────────
async function time(label: string, url: string) {
  // One untimed call first: the very first query pays for connection setup and plan
  // caching, which a user only ever pays once per session and would otherwise dominate.
  await app.inject({ method: "GET", url });

  const ms: number[] = [];
  let count = 0;
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const r = await app.inject({ method: "GET", url });
    ms.push(performance.now() - start);
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    count = Array.isArray(body.results) ? body.results.length : body.total;
  }
  ms.sort((a, b) => a - b);
  const median = ms[Math.floor(ms.length / 2)];
  const worst = ms[ms.length - 1];
  console.log(
    `${label.padEnd(34)} median ${median.toFixed(1).padStart(6)}ms   worst ${worst.toFixed(1).padStart(6)}ms   (${count} results)`
  );
  return { label, median, worst };
}

const q = (s: string) => encodeURIComponent(s);
console.log(`each figure is the median and worst of ${RUNS} runs, after one warm-up\n`);

const results = [
  // "zarquon" is planted in note bodies only and matches no folder or tag name.
  await time("content only", `/api/notes/search?q=${q("zarquon")}`),
  // "ledgerwick" and "phlogiston" name a folder and a tag and appear in no note text.
  await time("folder name only", `/api/notes/search?q=${q("ledgerwick")}`),
  await time("tag name only", `/api/notes/search?q=${q("phlogiston")}`),
  // A query that is both a content term and a folder name.
  await time("content + folder name", `/api/notes/search?q=${q("budget")}`),
  await time("scoped to a folder", `/api/notes/search?q=${q("zarquon")}&folderId=${folders[1].id}`),
  await time("scoped to a tag", `/api/notes/search?q=${q("zarquon")}&tagId=${tags[1].id}`),
  // The floor: below MIN_NAME_QUERY_LENGTH the folder/tag branch does not run at all.
  await time("below the 2-char floor", `/api/notes/search?q=${q("z")}`),
  // The counts behind the scope selector — two GROUP BY aggregates over the same
  // predicate, run once when the dropdown opens rather than on every keystroke.
  await time("facet counts (selector open)", `/api/notes/search/facets?q=${q("zarquon")}`),
  await time("facet counts, folder-name hit", `/api/notes/search/facets?q=${q("ledgerwick")}`),
];

const slowest = results.reduce((a, b) => (b.worst > a.worst ? b : a));
console.log(`\nslowest shape: ${slowest.label} (worst ${slowest.worst.toFixed(1)}ms)`);
console.log(`PRD §5 target is ~150ms — ${slowest.worst < 150 ? "PASS" : "FAIL"}\n`);

// ── The plan ──────────────────────────────────────────────────────────────────
console.log("EXPLAIN ANALYZE, content + folder branches (the shape the route runs):\n");
const plan = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
  `EXPLAIN ANALYZE
   SELECT n."id" FROM "Note" n
   WHERE n."deletedAt" IS NULL AND n."isLocked" = false
     AND (
       (
         (n."contentLanguage" = 'english' AND n."content_tsv" @@ websearch_to_tsquery('english', 'zarquon'))
         OR
         (n."contentLanguage" = 'french' AND n."content_tsv" @@ websearch_to_tsquery('french', 'zarquon'))
       )
       OR n."folderId" = ANY($1::text[])
       OR EXISTS (SELECT 1 FROM "NoteTag" nt WHERE nt."noteId" = n."id" AND nt."tagId" = ANY($2::text[]))
     )`,
  [folders[0].id],
  [tags[0].id]
);
console.log(plan.map((r) => Object.values(r)[0]).join("\n"));

// At a few thousand rows the planner will choose a sequential scan whatever indexes
// exist, because scanning 3,000 short rows is genuinely cheaper than an index lookup —
// which is exactly what search-language.test.ts says, and why that file asserts on the
// SHAPE of the tsquery rather than on the scan type. The question the plan above cannot
// answer, then, is whether the GIN index is still REACHABLE by this query now that the
// WHERE has grown two more branches. Turning the sequential scan off asks it directly:
// if the index can serve the content branch, the planner will use it when denied the
// alternative.
console.log("\nwith enable_seqscan off — is the GIN index still reachable at all?\n");
await prisma.$executeRawUnsafe(`SET enable_seqscan = off`);
const planNoSeq = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
  `EXPLAIN ANALYZE
   SELECT n."id" FROM "Note" n
   WHERE n."deletedAt" IS NULL AND n."isLocked" = false
     AND (
       (n."contentLanguage" = 'english' AND n."content_tsv" @@ websearch_to_tsquery('english', 'zarquon'))
       OR
       (n."contentLanguage" = 'french' AND n."content_tsv" @@ websearch_to_tsquery('french', 'zarquon'))
     )`
);
console.log(planNoSeq.map((r) => Object.values(r)[0]).join("\n"));
// The plan above answered a slightly different question than intended — Postgres
// reached for the (deletedAt, archivedAt, …) index instead, because that one covers the
// whole table cheaply and the filter does the rest. So ask the narrowest possible
// question: given only the tsvector predicate, is the GIN index chosen?
console.log("\nthe tsvector predicate alone — which index serves it?\n");
const planTsv = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
  `EXPLAIN ANALYZE
   SELECT n."id" FROM "Note" n
   WHERE n."content_tsv" @@ websearch_to_tsquery('english', 'zarquon')`
);
console.log(planTsv.map((r) => Object.values(r)[0]).join("\n"));

const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
  `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Note' AND indexdef ILIKE '%gin%'`
);
console.log(`\nGIN indexes on "Note": ${idx.length ? idx.map((i) => i.indexname).join(", ") : "NONE"}`);

await prisma.$executeRawUnsafe(`SET enable_seqscan = on`);

console.log("\nsame query with the content branch alone, for comparison:\n");
const plan2 = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
  `EXPLAIN ANALYZE
   SELECT n."id" FROM "Note" n
   WHERE n."deletedAt" IS NULL AND n."isLocked" = false
     AND (
       (n."contentLanguage" = 'english' AND n."content_tsv" @@ websearch_to_tsquery('english', 'zarquon'))
       OR
       (n."contentLanguage" = 'french' AND n."content_tsv" @@ websearch_to_tsquery('french', 'zarquon'))
     )`
);
console.log(plan2.map((r) => Object.values(r)[0]).join("\n"));

await app.close();
await prisma.$disconnect();
await db.stop();
