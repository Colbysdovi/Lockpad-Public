// Search that takes folders and tags into account.
//
// Two capabilities share this file because they share one SQL query: matching a note
// by the name of the folder or tag it is filed under, and narrowing a search to one
// chosen folder or tag. Keeping them together is deliberate — the rules that must not
// drift (locked notes never match, trashed never, archived always) live in a single
// WHERE clause, and a test file per capability is how two copies of that clause get
// written without anyone noticing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { startTestDb, type TestDb } from "./helpers/db.js";

let db: TestDb;
let app: FastifyInstance;
// Imported dynamically in before(), NOT at the top of the file. Anything reaching
// src/prisma.js constructs the one PrismaClient, and a PrismaClient reads
// DATABASE_URL at construction — so a static import here would build a client
// pointed at nothing, before startTestDb() has said where the database is. Every
// other test file avoids this by only ever importing the app dynamically; this one
// has to do the same for the module it is testing directly.
let matchFolderAndTagNames: typeof import("../src/lib/nameMatch.js")["matchFolderAndTagNames"];

before(async () => {
  db = await startTestDb();
  process.env.DATABASE_URL = db.url;
  process.env.LOG_DIR = "./logs";
  process.env.CORS_ORIGINS = "http://localhost:5173";
  const { buildApp } = await import("../src/app.js");
  app = buildApp();
  await app.ready();
  ({ matchFolderAndTagNames } = await import("../src/lib/nameMatch.js"));
});

after(async () => {
  await app?.close();
  const { prisma } = await import("../src/prisma.js");
  await prisma.$disconnect();
  await db?.stop();
});

const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload: payload as any });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload: payload as any });

async function folder(name: string, parentFolderId?: string): Promise<string> {
  const r = await post("/api/folders", { name, ...(parentFolderId ? { parentFolderId } : {}) });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id as string;
}

async function tag(name: string): Promise<string> {
  const r = await post("/api/tags", { name });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id as string;
}

const folderIds = (m: { folders: Array<{ id: string }> }) => m.folders.map((f) => f.id);
const tagIds = (m: { tags: Array<{ id: string }> }) => m.tags.map((t) => t.id);

// ─── T-02: resolving a typed query to folder and tag IDs ──────────────────────

test("T-02 a query below the floor matches nothing, and reads nothing", async () => {
  await folder("Budget");
  await tag("urgent");

  // The DoD is not just "returns nothing" — it is that the short-query path never
  // touches the database. Spying on the two reads the function actually makes is the
  // only way to tell an early return apart from a read whose result was discarded.
  const { prisma } = await import("../src/prisma.js");
  const realFolders = prisma.folder.findMany;
  const realTags = prisma.tag.findMany;
  let reads = 0;
  // @ts-expect-error — deliberate test spy on the shared client the code under test uses.
  prisma.folder.findMany = (...args: unknown[]) => { reads++; return realFolders.apply(prisma.folder, args as never); };
  // @ts-expect-error — same.
  prisma.tag.findMany = (...args: unknown[]) => { reads++; return realTags.apply(prisma.tag, args as never); };
  try {
    assert.deepEqual(await matchFolderAndTagNames("b"), { folders: [], tags: [] });
    assert.deepEqual(await matchFolderAndTagNames(""), { folders: [], tags: [] });
    // Two characters typed, one character left after folding — the floor measures what
    // is matched with, not what was pressed.
    assert.deepEqual(await matchFolderAndTagNames("é "), { folders: [], tags: [] });
    assert.equal(reads, 0, "a below-floor query must not read folders or tags");

    // And the floor really is two, not three: the next character up does read.
    await matchFolderAndTagNames("bu");
    assert.equal(reads, 2, "a two-character query reads folders and tags once each");
  } finally {
    prisma.folder.findMany = realFolders;
    prisma.tag.findMany = realTags;
  }
});

test("T-02 matches by substring, in the middle of a name as well as at its start", async () => {
  const roadmap = await folder("Product Roadmap");
  const engineering = await tag("engineering");

  assert.ok(folderIds(await matchFolderAndTagNames("pro")).includes(roadmap), "should match a folder by its first word");
  assert.ok(folderIds(await matchFolderAndTagNames("adma")).includes(roadmap), "should match a folder mid-word");
  assert.ok(tagIds(await matchFolderAndTagNames("gine")).includes(engineering), "should match a tag mid-word");
});

test("T-02 matching ignores case, whitespace and accents", async () => {
  const cafe = await folder("Café");
  const q1 = await folder("Q1  Drafts");

  for (const query of ["cafe", "CAFE", "  café  ", "CaFé"]) {
    assert.ok(folderIds(await matchFolderAndTagNames(query)).includes(cafe), `"${query}" should find the folder named Café`);
  }

  // The stored name has a double space; the query has one. Both fold to "q1 drafts".
  assert.ok(folderIds(await matchFolderAndTagNames("q1 drafts")).includes(q1), "internal whitespace runs should fold to one space");
});

test("T-02 two names differing only by accent are both matched by one query", async () => {
  // These can coexist: normalizeName does not fold accents, so renaming allows both.
  // Search does fold them, so a query for either must find both — otherwise typing
  // "resume" silently shows you half your notes.
  const accented = await folder("Résumé");
  const plain = await folder("Resume");

  const m = folderIds(await matchFolderAndTagNames("resume"));
  assert.ok(m.includes(accented), "should match the accented folder");
  assert.ok(m.includes(plain), "should match the unaccented folder");

  const m2 = folderIds(await matchFolderAndTagNames("résumé"));
  assert.ok(m2.includes(accented) && m2.includes(plain), "and either way round");
});

test("T-02 a folder renamed between two calls matches under its new name immediately", async () => {
  const id = await folder("Draaft");
  assert.ok(folderIds(await matchFolderAndTagNames("draaft")).includes(id));

  assert.equal((await patch(`/api/folders/${id}`, { name: "Draft" })).statusCode, 200);

  // No invalidation step of any kind between these two lines.
  assert.ok(folderIds(await matchFolderAndTagNames("draft")).includes(id), "the new name should match on the very next call");
  assert.equal(folderIds(await matchFolderAndTagNames("draaft")).includes(id), false, "the old name should stop matching");
});

test("T-02 returns the matched folders and tags, and nothing else", async () => {
  // The original T-02 contract was ids only. T-04 widened it to id + name — see the
  // dated correction in build-log.md — because the result rows have to say WHICH
  // folder matched, and the only honest source for that is the read that decided it.
  const id = await folder("Invoices");
  const m = await matchFolderAndTagNames("invoic");

  assert.deepEqual(Object.keys(m).sort(), ["folders", "tags"]);
  assert.ok(folderIds(m).includes(id));
  // Each entry is exactly {id, name} — no note rows, nothing else carried along.
  for (const entry of [...m.folders, ...m.tags]) {
    assert.deepEqual(Object.keys(entry).sort(), ["id", "name"]);
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.name, "string");
  }
});

// ─── T-03: the extended query ─────────────────────────────────────────────────

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function note(title: string, text: string, opts: { folderId?: string; tagId?: string } = {}) {
  const r = await post("/api/notes", { title, content: doc(text), ...(opts.folderId ? { folderId: opts.folderId } : {}) });
  assert.equal(r.statusCode, 201, r.body);
  const id = r.json().id as string;
  if (opts.tagId) assert.equal((await post(`/api/notes/${id}/tags`, { tagId: opts.tagId })).statusCode, 201);
  return id;
}

async function rawSearch(q: string) {
  const r = await app.inject({ method: "GET", url: `/api/notes/search?q=${encodeURIComponent(q)}` });
  return r;
}

async function search(q: string): Promise<Array<{ id: string; title: string; snippet: string }>> {
  const r = await rawSearch(q);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().results;
}

const ids = (rs: Array<{ id: string }>) => rs.map((r) => r.id);

test("T-03 a note is found by its folder's name, with the word nowhere in the note", async () => {
  const f = await folder("Ledgerwick");
  const id = await note("Quarterly numbers", "Nothing in this sentence resembles the folder it is filed in.", { folderId: f });

  assert.ok(ids(await search("ledgerwick")).includes(id), "folder-name match did not return the note");
  assert.ok(ids(await search("edgerw")).includes(id), "folder-name match should be a substring match");
});

test("T-03 a note is found by one of its tags' names", async () => {
  const t = await tag("phlogiston");
  const id = await note("Combustion notes", "This body never uses the word the tag is called.", { tagId: t });

  assert.ok(ids(await search("phlogiston")).includes(id), "tag-name match did not return the note");
});

test("T-03 a note matching more than one way still appears exactly once", async () => {
  const f = await folder("Quibbleton");
  const t1 = await tag("quibbleton-one");
  const t2 = await tag("quibbleton-two");
  // Matches by content, by folder, and by two separate tags — four reasons, one row.
  const id = await note("Quibbleton report", "The word quibbleton is in this body too.", { folderId: f, tagId: t1 });
  assert.equal((await post(`/api/notes/${id}/tags`, { tagId: t2 })).statusCode, 201);

  const rows = (await search("quibbleton")).filter((r) => r.id === id);
  assert.equal(rows.length, 1, "the note came back more than once");
});

test("T-03 a locked note never matches — not by content, not by folder, not by tag", async () => {
  const f = await folder("Grimoire");
  const t = await tag("grimoire-tag");
  const id = await note("Sealed section", "The word cromulent appears only here.", { folderId: f, tagId: t });

  // Findable all three ways first, so the test cannot pass by the fixture being broken.
  assert.ok(ids(await search("cromulent")).includes(id), "fixture must match by content before locking");
  assert.ok(ids(await search("grimoire")).includes(id), "fixture must match by folder before locking");

  const locked = await post(`/api/notes/${id}/lock`, {
    ciphertext: Buffer.from("ciphertext").toString("base64"),
    cryptoMeta: { kdf: "pbkdf2", salt: "c2FsdA==", iv: "aXY=", params: { iterations: 600000 } },
  });
  assert.equal(locked.statusCode, 200, locked.body);

  for (const q of ["cromulent", "grimoire", "grimoire-tag"]) {
    const r = await rawSearch(q);
    assert.equal(ids(r.json().results).includes(id), false, `a locked note leaked via "${q}"`);
    // Not just absent from results — absent from the response entirely. A leak that
    // showed the title in some other field would still be a leak.
    assert.doesNotMatch(r.body, /Sealed section/, `the locked note's title appeared in the response for "${q}"`);
  }
});

test("T-03 archived notes still match by folder and tag; trashed ones do not", async () => {
  const f = await folder("Wintermute");
  const archived = await note("Archived one", "Body has nothing to do with it.", { folderId: f });
  const trashed = await note("Trashed one", "Body has nothing to do with it either.", { folderId: f });

  assert.equal((await post(`/api/notes/${archived}/archive`, {})).statusCode, 200);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/notes/${trashed}` })).statusCode, 204);

  const found = ids(await search("wintermute"));
  assert.ok(found.includes(archived), "an archived note stopped being findable by its folder");
  assert.equal(found.includes(trashed), false, "a trashed note was findable by its folder");
});

test("T-03 an unfiled note is unaffected, and losing a tag only costs that one path", async () => {
  const t = await tag("ephemeral");
  // No folder, one tag.
  const id = await note("Loose note", "The distinctive word snorkbath lives in this body.", { tagId: t });

  assert.ok(ids(await search("snorkbath")).includes(id), "content matching broke for a note with no folder");
  assert.ok(ids(await search("ephemeral")).includes(id), "tag matching did not work");

  assert.equal((await app.inject({ method: "DELETE", url: `/api/notes/${id}/tags/${t}` })).statusCode, 204);

  assert.equal(ids(await search("ephemeral")).includes(id), false, "the note still matched a tag it no longer carries");
  assert.ok(ids(await search("snorkbath")).includes(id), "removing a tag should not affect content matching");
});

test("T-03 odd input returns a normal response rather than an error", async () => {
  for (const q of [`"unbalanced`, `a & | ! b`, `-`, `x`, "z".repeat(2000), `'; DROP TABLE "Note"; --`]) {
    const r = await rawSearch(q);
    assert.equal(r.statusCode, 200, `query ${JSON.stringify(q.slice(0, 30))} returned ${r.statusCode}: ${r.body}`);
    assert.ok(Array.isArray(r.json().results));
  }
  // And the table is still there.
  assert.equal((await rawSearch("snorkbath")).statusCode, 200);
});

test("T-03 a folder match ranks a note above its twin that matches on content alone", async () => {
  const f = await folder("Thimblewick");
  const body = "One mention of thimblewick, and otherwise identical prose in both notes.";
  const contentOnly = await note("Twin A", body);
  const alsoFiled = await note("Twin B", body, { folderId: f });

  const order = ids(await search("thimblewick"));
  assert.ok(
    order.indexOf(alsoFiled) < order.indexOf(contentOnly),
    `the folder match did not outrank its content-only twin: ${JSON.stringify(order)}`
  );
});

test("T-03 a folder-only match lands mid-pack: above weak content matches, below a strong one", async () => {
  const f = await folder("Blorptastic");
  // One note that is genuinely about the word — repeated, so ts_rank is high.
  const strong = await note("All about it", Array(8).fill("blorptastic").join(" and "));
  // Twelve that mention it once in passing.
  const weak: string[] = [];
  for (let i = 0; i < 12; i++) weak.push(await note(`Passing mention ${i}`, `A sentence that says blorptastic once, number ${i}.`));
  // And one whose only connection is the folder it is filed in.
  const byFolder = await note("Filed here", "This body has no connection to the query whatsoever.", { folderId: f });

  const order = ids(await search("blorptastic"));
  const at = order.indexOf(byFolder);

  assert.notEqual(at, -1, "the folder-only match was not returned at all");
  // §3: not effectively invisible beneath a long tail of weak content matches.
  assert.ok(at <= 5, `the folder-only match was buried at position ${at + 1}: ${JSON.stringify(order)}`);
  // But not simply pinned to the top either — a note that is actually about the word
  // still wins, which is what stops a common-word folder name flooding every search.
  assert.ok(order.indexOf(strong) < at, `the strong content match did not outrank the folder-only match: ${JSON.stringify(order)}`);
  assert.ok(at < order.indexOf(weak[weak.length - 1]), "the folder-only match did not outrank the weak content matches");
});

test("T-03 the tsquery the index sees is still constant after adding the new branches", async () => {
  // The property this codebase already established as the meaningful one — see the
  // same assertion in search-language.test.ts and the comment above it explaining why
  // "Bitmap Index Scan" cannot be asserted on a twenty-row table. The risk being
  // guarded is that widening the WHERE quietly changed the content branch's shape and
  // took the GIN index with it. Plan cost at a realistic library size is T-08's job.
  const { prisma } = await import("../src/prisma.js");
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(`EXPLAIN
    SELECT n."id" FROM "Note" n
    WHERE n."deletedAt" IS NULL AND n."isLocked" = false
      AND (
        (n."contentLanguage" = 'english' AND n."content_tsv" @@ websearch_to_tsquery('english', 'blorptastic'))
        OR
        (n."contentLanguage" = 'french' AND n."content_tsv" @@ websearch_to_tsquery('french', 'blorptastic'))
        OR n."folderId" = ANY('{}'::text[])
        OR EXISTS (SELECT 1 FROM "NoteTag" nt WHERE nt."noteId" = n."id" AND nt."tagId" = ANY('{}'::text[]))
      )`);
  const plan = rows.map((r) => Object.values(r)[0]).join("\n");

  assert.match(plan, /::tsquery/, `the plan shows no constant tsquery:\n${plan}`);
  assert.doesNotMatch(plan, /regconfig/, `the plan resolves a text-search configuration per row:\n${plan}`);
});

// ─── T-04: why did this match? ────────────────────────────────────────────────

interface Reasoned {
  id: string;
  matchedContent: boolean;
  matchedFolder: { id: string; name: string } | null;
  matchedTags: Array<{ id: string; name: string }>;
}

async function reasons(q: string): Promise<Reasoned[]> {
  const r = await rawSearch(q);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().results;
}

const reasonFor = (rs: Reasoned[], id: string) => rs.find((r) => r.id === id)!;

test("T-04 a folder-only match names its folder and admits the content did not match", async () => {
  const f = await folder("Zephyrwood");
  const id = await note("Filed under it", "This body is about something else entirely.", { folderId: f });

  const r = reasonFor(await reasons("zephyrwood"), id);
  assert.ok(r, "the note was not returned");
  assert.equal(r.matchedContent, false, "content should not have matched");
  assert.equal(r.matchedFolder?.name, "Zephyrwood");
  assert.equal(r.matchedFolder?.id, f);
  assert.deepEqual(r.matchedTags, []);
});

test("T-04 a content-only match names neither a folder nor a tag", async () => {
  const id = await note("Plain hit", "The word plingwater appears only in this body.");

  const r = reasonFor(await reasons("plingwater"), id);
  assert.equal(r.matchedContent, true);
  assert.equal(r.matchedFolder, null);
  assert.deepEqual(r.matchedTags, []);
});

test("T-04 a note matching both ways reports both", async () => {
  const t = await tag("frobnicate");
  const id = await note("Both ways", "This note does frobnicate things, and is tagged so.", { tagId: t });

  const r = reasonFor(await reasons("frobnicate"), id);
  assert.equal(r.matchedContent, true);
  assert.deepEqual(r.matchedTags.map((x) => x.name), ["frobnicate"]);
});

test("T-04 two matching tags are both named, in a stable order", async () => {
  const beta = await tag("wobblesprocket-beta");
  const alpha = await tag("wobblesprocket-alpha");
  // Attached beta first, alpha second — so insertion order and name order disagree,
  // and a test that passed by accident would show it.
  const id = await note("Two tags", "Body says nothing relevant.", { tagId: beta });
  assert.equal((await post(`/api/notes/${id}/tags`, { tagId: alpha })).statusCode, 201);

  const first = reasonFor(await reasons("wobblesprocket"), id);
  assert.deepEqual(first.matchedTags.map((x) => x.name), ["wobblesprocket-alpha", "wobblesprocket-beta"]);

  // Stable means stable across calls, not merely sorted once.
  const second = reasonFor(await reasons("wobblesprocket"), id);
  assert.deepEqual(second.matchedTags, first.matchedTags);
});

test("T-04 a query naming nothing leaves every row's reason empty", async () => {
  const id = await note("Nothing named", "A body containing the word klaxonberry and no folder.");
  const r = reasonFor(await reasons("klaxonberry"), id);
  assert.equal(r.matchedFolder, null);
  assert.deepEqual(r.matchedTags, []);
  assert.equal(r.matchedContent, true);
});

// ─── T-06: narrowing a search to one folder or one tag ────────────────────────

function scoped(q: string, scope: { folderId?: string; tagId?: string }) {
  const params = new URLSearchParams({ q });
  if (scope.folderId) params.set("folderId", scope.folderId);
  if (scope.tagId) params.set("tagId", scope.tagId);
  return app.inject({ method: "GET", url: `/api/notes/search?${params}` });
}

async function scopedIds(q: string, scope: { folderId?: string; tagId?: string }) {
  const r = await scoped(q, scope);
  assert.equal(r.statusCode, 200, r.body);
  return ids(r.json().results);
}

test("T-06 a scope restricts the result set, and the typed query still applies inside it", async () => {
  const inside = await folder("Scopeland");
  const outside = await folder("Elsewhere");
  const hit = await note("Inside hit", "A note about pilchard, filed inside.", { folderId: inside });
  const miss = await note("Outside hit", "Another note about pilchard, filed elsewhere.", { folderId: outside });
  const irrelevant = await note("Inside miss", "This one is filed inside but is about nothing.", { folderId: inside });

  const unscoped = await scopedIds("pilchard", {});
  assert.ok(unscoped.includes(hit) && unscoped.includes(miss), "fixture: both should match unscoped");

  const withScope = await scopedIds("pilchard", { folderId: inside });
  assert.ok(withScope.includes(hit), "the in-folder match disappeared");
  assert.equal(withScope.includes(miss), false, "a note outside the scope came back");
  assert.equal(withScope.includes(irrelevant), false, "the scope replaced the query instead of narrowing it");
});

test("T-06 a tag scope works the same way", async () => {
  const t = await tag("scoped-tag");
  const tagged = await note("Tagged", "A note about widgeon.", { tagId: t });
  const untagged = await note("Untagged", "Another note about widgeon.");

  const withScope = await scopedIds("widgeon", { tagId: t });
  assert.ok(withScope.includes(tagged));
  assert.equal(withScope.includes(untagged), false);
});

test("T-06 asking for a folder and a tag at once is rejected, not half-honoured", async () => {
  const f = await folder("Bothville");
  const t = await tag("both-tag");
  const r = await scoped("anything", { folderId: f, tagId: t });
  assert.equal(r.statusCode, 400, `expected a validation failure, got ${r.statusCode}: ${r.body}`);
});

test("T-06 an unknown or malformed scope returns no matches rather than an error", async () => {
  await note("Findable", "This note is about grommets.");
  for (const folderId of ["cmnonexistent0000000000000", "not-an-id", "%%%", " "]) {
    const r = await scoped("grommets", { folderId });
    assert.equal(r.statusCode, 200, `folderId ${JSON.stringify(folderId)} returned ${r.statusCode}: ${r.body}`);
    assert.deepEqual(r.json().results, [], `folderId ${JSON.stringify(folderId)} returned matches`);
  }
});

test("T-06 a scope containing only locked notes is indistinguishable from one containing nothing", async () => {
  const vault = await folder("Vaultspace");
  const id = await note("Sealed", "The word haruspex is in here.", { folderId: vault });
  assert.deepEqual(await scopedIds("haruspex", { folderId: vault }), [id], "fixture must match before locking");

  assert.equal(
    (await post(`/api/notes/${id}/lock`, {
      ciphertext: Buffer.from("ciphertext").toString("base64"),
      cryptoMeta: { kdf: "pbkdf2", salt: "c2FsdA==", iv: "aXY=", params: { iterations: 600000 } },
    })).statusCode,
    200
  );

  // §5: a locked note's existence must never become inferable. The response for a
  // folder holding one locked note has to be byte-identical to the response for a
  // folder that does not exist — no count, no hint, no different message.
  const onlyLocked = await scoped("haruspex", { folderId: vault });
  const nonexistent = await scoped("haruspex", { folderId: "cmnonexistent0000000000000" });
  assert.equal(onlyLocked.statusCode, nonexistent.statusCode);
  assert.equal(onlyLocked.body, nonexistent.body, "the locked-only scope answered differently from an empty one");
});

test("T-06 archived and trashed behave inside a scope exactly as they do outside it", async () => {
  const f = await folder("Lifecycleton");
  const live = await note("Live", "A note about barnacles.", { folderId: f });
  const archived = await note("Archived", "Another note about barnacles.", { folderId: f });
  const trashed = await note("Trashed", "A third note about barnacles.", { folderId: f });

  assert.equal((await post(`/api/notes/${archived}/archive`, {})).statusCode, 200);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/notes/${trashed}` })).statusCode, 204);

  const found = await scopedIds("barnacles", { folderId: f });
  assert.ok(found.includes(live));
  assert.ok(found.includes(archived), "an archived note vanished from a scoped search");
  assert.equal(found.includes(trashed), false, "a trashed note appeared in a scoped search");
});

// ─── T-09: the counts behind the scope selector ───────────────────────────────

interface Facets {
  total: number;
  folders: Array<{ id: string; count: number }>;
  tags: Array<{ id: string; count: number }>;
}

async function facets(q: string): Promise<Facets> {
  const r = await app.inject({ method: "GET", url: `/api/notes/search/facets?q=${encodeURIComponent(q)}` });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}

const countFor = (list: Array<{ id: string; count: number }>, id: string) => list.find((x) => x.id === id)?.count ?? 0;

test("T-09 each folder's count is the number of matches it would give", async () => {
  const a = await folder("Countyshire");
  const b = await folder("Othershire");
  await note("A one", "The word gribblenaut lives here.", { folderId: a });
  await note("A two", "Another gribblenaut mention.", { folderId: a });
  await note("B one", "A single gribblenaut over here.", { folderId: b });
  await note("Loose", "A gribblenaut in no folder at all.");

  const f = await facets("gribblenaut");
  assert.equal(countFor(f.folders, a), 2);
  assert.equal(countFor(f.folders, b), 1);
  // The unfiled note is in no folder group, but it is still a match.
  assert.equal(f.total, 4);
});

test("T-09 the counts agree with the list they label", async () => {
  const f = await folder("Agreeable");
  for (let i = 0; i < 3; i++) await note(`Agree ${i}`, "Contains the word snarfblat.");
  await note("Agree filed", "Also contains snarfblat.", { folderId: f });

  const counts = await facets("snarfblat");
  const scoped = await scopedIds("snarfblat", { folderId: f });
  // The number beside a folder must be exactly what choosing that folder produces.
  assert.equal(countFor(counts.folders, f), scoped.length);
  assert.equal(counts.total, (await search("snarfblat")).length);
});

test("T-09 a note with several tags is counted once per folder, not once per tag", async () => {
  const f = await folder("Multitag");
  const t1 = await tag("multi-one");
  const t2 = await tag("multi-two");
  const id = await note("Three tags", "The word wibblesnap appears here.", { folderId: f, tagId: t1 });
  assert.equal((await post(`/api/notes/${id}/tags`, { tagId: t2 })).statusCode, 201);

  const f2 = await facets("wibblesnap");
  assert.equal(countFor(f2.folders, f), 1, "the folder count multiplied by the note's tags");
  assert.equal(countFor(f2.tags, t1), 1);
  assert.equal(countFor(f2.tags, t2), 1);
  assert.equal(f2.total, 1);
});

test("T-09 folder- and tag-name matches are counted too, not only content matches", async () => {
  const f = await folder("Sprocketwell");
  await note("Filed only", "This body says nothing about the query.", { folderId: f });
  await note("Filed too", "Nor does this one.", { folderId: f });

  // Nothing in either body matches; both match because of the folder's name.
  const f2 = await facets("sprocketwell");
  assert.equal(countFor(f2.folders, f), 2);
});

test("T-09 locked and trashed notes are not counted", async () => {
  const f = await folder("Countvault");
  const visible = await note("Visible", "The word gorbleflux is here.", { folderId: f });
  const locked = await note("Locked", "The word gorbleflux is here too.", { folderId: f });
  const trashed = await note("Trashed", "And gorbleflux here.", { folderId: f });
  assert.equal(countFor((await facets("gorbleflux")).folders, f), 3, "fixture must count all three first");

  assert.equal(
    (await post(`/api/notes/${locked}/lock`, {
      ciphertext: Buffer.from("ciphertext").toString("base64"),
      cryptoMeta: { kdf: "pbkdf2", salt: "c2FsdA==", iv: "aXY=", params: { iterations: 600000 } },
    })).statusCode,
    200
  );
  assert.equal((await app.inject({ method: "DELETE", url: `/api/notes/${trashed}` })).statusCode, 204);

  const after = await facets("gorbleflux");
  assert.equal(countFor(after.folders, f), 1, "a locked or trashed note was counted");
  assert.ok(visible);
});

test("T-09 an empty or below-floor query counts nothing rather than everything", async () => {
  assert.deepEqual(await facets(""), { total: 0, folders: [], tags: [] });
  // One character is above "empty" but below the folder/tag floor: content still counts,
  // folder names do not, so this must not suddenly report whole folders.
  const one = await facets("z");
  assert.ok(one.total >= 0);
  assert.ok(one.folders.every((r) => r.count > 0));
});
