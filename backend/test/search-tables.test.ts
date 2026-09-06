// Can you find a note by something you only wrote inside a table?
//
// The search index is built by a SQL function that walks the note's JSON with a
// recursive `$.**.text` jsonpath, so in principle it reaches a table cell without
// knowing what a table is. In principle is not the same as in fact: the PRD asks for
// this to be confirmed rather than assumed by analogy, because a note that cannot be
// found is a note that is effectively lost, and nothing about the failure is visible —
// the search simply returns nothing and the user concludes they never wrote it.
//
// The negative case matters as much as the positive one: a search that returns
// everything would pass a naive "is my note in the results" test while proving nothing.
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

const cell = (type: "tableHeader" | "tableCell", text: string) => ({
  type,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const row = (type: "tableHeader" | "tableCell", ...values: string[]) => ({
  type: "tableRow",
  content: values.map((v) => cell(type, v)),
});

async function search(q: string) {
  const r = await app.inject({ method: "GET", url: `/api/notes/search?q=${encodeURIComponent(q)}` });
  assert.equal(r.statusCode, 200);
  // The endpoint answers { results: [...] }, each carrying id/title/snippet.
  return r.json().results as { id: string; title: string; snippet: string }[];
}

test("a word typed only into a table cell still finds its note", async () => {
  // The title and every paragraph deliberately avoid the search term, so a hit can
  // only have come from inside the table.
  const created = await app.inject({
    method: "POST",
    url: "/api/notes",
    payload: {
      title: "Hosting options",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Written up after the review." }] },
          {
            type: "table",
            content: [
              row("tableHeader", "Option", "Verdict"),
              row("tableCell", "Synology", "Chosen"),
              row("tableCell", "Managed", "Rejected"),
            ],
          },
        ],
      },
    },
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;

  const hits = await search("Synology");
  assert.ok(hits.some((n) => n.id === id), "the note should be found by a word only present in a table cell");
});

test("a header cell is indexed too, not just the body cells", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/notes",
    payload: {
      title: "Spec",
      content: {
        type: "doc",
        content: [{ type: "table", content: [row("tableHeader", "Throughput", "Latency"), row("tableCell", "high", "low")] }],
      },
    },
  });
  const id = created.json().id;
  const hits = await search("Throughput");
  assert.ok(hits.some((n) => n.id === id), "a column heading should be searchable");
});

test("search is still discriminating — it does not just return everything", async () => {
  // Without this, the two tests above would pass against an index that matched anything.
  const hits = await search("Synology");
  assert.ok(
    hits.every((n) => n.title !== "Spec"),
    "a note with no occurrence of the term must not be returned",
  );
});
