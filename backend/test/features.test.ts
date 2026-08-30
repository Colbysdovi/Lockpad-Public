// Integration tests for the features layered on top of basic note storage:
// folders and their tree, tags, note-to-note links and backlinks, pinning,
// archive/trash lifecycle, locking, and the bulk actions.
//
// Same setup as notes.test.ts — a real throwaway Postgres and in-process requests —
// because these are the areas where the interesting behaviour is relational:
// deleting a folder must not delete its notes, a locked note must never come back
// with its contents, a pin must be scoped to one list, and a bulk action must apply
// to all of its ids or none.
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

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload: payload as any });
const get = (url: string) => app.inject({ method: "GET", url });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload: payload as any });

// ── T-05 Folders ──────────────────────────────────────────────────────────────
test("T-05 folders: create, tree, cycle rejection, filtered notes", async () => {
  const work = (await post("/api/folders", { name: "Work" })).json();
  const proj = (await post("/api/folders", { name: "Projects", parentFolderId: work.id })).json();
  const tree = (await get("/api/folders")).json();
  const root = tree.folders.find((f: any) => f.id === work.id);
  assert.ok(root, "work folder is a root");
  assert.equal(root.children[0].id, proj.id, "projects nested under work");

  // Cycle: make work a child of proj → rejected.
  const cyc = await app.inject({ method: "PATCH", url: `/api/folders/${work.id}`, payload: { parentFolderId: proj.id } });
  assert.equal(cyc.statusCode, 400);

  // Folder-filtered notes.
  const n = (await post("/api/notes", { title: "InWork", folderId: work.id, content: doc("x") })).json();
  const filtered = (await get(`/api/notes?folderId=${work.id}`)).json();
  assert.ok(filtered.notes.some((x: any) => x.id === n.id));
});

// ── Note color ──────────────────────────────────────────────────────────────
test("note color: set via PATCH, appears on card + detail, invalid rejected, cleared with null", async () => {
  const patch = (url: string, payload: unknown) => app.inject({ method: "PATCH", url, payload: payload as any });
  const note = (await post("/api/notes", { title: "Colorful", content: doc("z") })).json();
  assert.equal(note.color, null, "new note has no color");

  // Set a valid color, and confirm it surfaces on card + detail serializations.
  assert.equal((await patch(`/api/notes/${note.id}`, { color: "teal" })).json().color, "teal");
  const list = (await get(`/api/notes`)).json();
  assert.equal(list.notes.find((n: any) => n.id === note.id).color, "teal");
  assert.equal((await get(`/api/notes/${note.id}`)).json().color, "teal");

  // Invalid color is rejected; clearing with null works.
  assert.equal((await patch(`/api/notes/${note.id}`, { color: "chartreuse" })).statusCode, 400);
  assert.equal((await patch(`/api/notes/${note.id}`, { color: null })).json().color, null);
});

test("note color: duplicate copies color; bulk color sets and clears", async () => {
  const src = (await post("/api/notes", { title: "Src", content: doc("d") })).json();
  await app.inject({ method: "PATCH", url: `/api/notes/${src.id}`, payload: { color: "purple" } as any });
  assert.equal((await post(`/api/notes/${src.id}/duplicate`)).json().color, "purple", "duplicate inherits color");

  const a = (await post("/api/notes", { title: "A", content: doc("a") })).json();
  const b = (await post("/api/notes", { title: "B", content: doc("b") })).json();
  assert.equal((await post("/api/notes/bulk", { action: "color", ids: [a.id, b.id], color: "amber" })).json().count, 2);
  assert.equal((await get(`/api/notes/${a.id}`)).json().color, "amber");
  assert.equal((await get(`/api/notes/${b.id}`)).json().color, "amber");

  await post("/api/notes/bulk", { action: "color", ids: [a.id, b.id], color: null });
  assert.equal((await get(`/api/notes/${a.id}`)).json().color, null);
});

// ── T-06 Tags ───────────────────────────────────────────────────────────────
test("T-06 tags: get-or-create idempotent, apply, filter", async () => {
  const t1 = (await post("/api/tags", { name: "urgent" })).json();
  const t2 = (await post("/api/tags", { name: "urgent" })).json();
  assert.equal(t1.id, t2.id, "duplicate tag name returns existing");

  const note = (await post("/api/notes", { title: "Tagged", content: doc("y") })).json();
  await post(`/api/notes/${note.id}/tags`, { name: "urgent" });
  await post(`/api/notes/${note.id}/tags`, { name: "later" });
  const byTag = (await get(`/api/notes?tagId=${t1.id}`)).json();
  assert.ok(byTag.notes.some((x: any) => x.id === note.id));
  const detail = (await get(`/api/notes/${note.id}`)).json();
  assert.equal(detail.tags.length, 2);
});

// ── Renaming tags and folders ────────────────────────────────────────────────
//
// The rules under test are the ones the rename forms show as you type. They are
// asserted HERE as well because the client check is a courtesy that reads a snapshot
// — the server is what actually holds the rule, and these are the tests that say so.

test("tag rename: keeps every note association and changes only the label", async () => {
  const tag = (await post("/api/tags", { name: "draaft" })).json();
  const note = (await post("/api/notes", { title: "Tagged for rename", content: doc("z") })).json();
  await post(`/api/notes/${note.id}/tags`, { tagId: tag.id });

  const res = await patch(`/api/tags/${tag.id}`, { name: "draft" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().name, "draft");
  assert.equal(res.json().id, tag.id, "same tag row, not a new one");

  // The whole point of renaming rather than delete-and-recreate: the note keeps the
  // tag, now reading differently, with nothing re-applied.
  const detail = (await get(`/api/notes/${note.id}`)).json();
  assert.ok(detail.tags.some((t: any) => t.id === tag.id && t.name === "draft"));
  // And the tag-filtered list still finds it by the same id.
  const byTag = (await get(`/api/notes?tagId=${tag.id}`)).json();
  assert.ok(byTag.notes.some((x: any) => x.id === note.id), "still filterable after rename");
});

test("tag rename: refuses a name another tag already has, folding case and whitespace", async () => {
  const a = (await post("/api/tags", { name: "Roadmap" })).json();
  await post("/api/tags", { name: "Backlog" });

  for (const attempt of ["Backlog", "backlog", "BACKLOG", "  backlog  "]) {
    const res = await patch(`/api/tags/${a.id}`, { name: attempt });
    assert.equal(res.statusCode, 409, `“${attempt}” should collide`);
    assert.match(res.json().error.message, /already called/);
  }

  // Internal spacing folds too: a run of spaces is the same name as one space.
  await post("/api/tags", { name: "Q1 planning" });
  assert.equal((await patch(`/api/tags/${a.id}`, { name: "Q1  planning" })).statusCode, 409);
  // But it only COLLAPSES runs, it does not delete them — these are different names.
  assert.equal((await patch(`/api/tags/${a.id}`, { name: "Q1planning" })).statusCode, 200);
  await patch(`/api/tags/${a.id}`, { name: "Roadmap" });
  // Untouched by the refusals.
  assert.equal((await get("/api/tags")).json().tags.find((t: any) => t.id === a.id).name, "Roadmap");
});

test("tag rename: its own current name is not a collision, and whitespace is trimmed", async () => {
  const tag = (await post("/api/tags", { name: "Steady" })).json();
  assert.equal((await patch(`/api/tags/${tag.id}`, { name: "Steady" })).statusCode, 200);
  // Same name wearing different spacing and case — still itself, still allowed.
  assert.equal((await patch(`/api/tags/${tag.id}`, { name: "  steady  " })).statusCode, 200);
  assert.equal((await get("/api/tags")).json().tags.find((t: any) => t.id === tag.id).name, "steady");
});

test("tag rename: an empty or whitespace-only name is rejected", async () => {
  const tag = (await post("/api/tags", { name: "Keeper" })).json();
  assert.equal((await patch(`/api/tags/${tag.id}`, { name: "" })).statusCode, 400);
  assert.equal((await patch(`/api/tags/${tag.id}`, { name: "   " })).statusCode, 400);
  assert.equal((await get("/api/tags")).json().tags.find((t: any) => t.id === tag.id).name, "Keeper");
});

test("tag rename: an unknown id is a 404, not a silent no-op", async () => {
  const res = await patch("/api/tags/ckzzzzzzzzzzzzzzzzzzzzzzz", { name: "Nowhere" });
  assert.equal(res.statusCode, 404);
});

test("folder rename: refuses a name used ANYWHERE in the tree, not merely by a sibling", async () => {
  const left = (await post("/api/folders", { name: "RenameLeft" })).json();
  const right = (await post("/api/folders", { name: "RenameRight" })).json();
  // A deliberately DIFFERENT branch: under siblings-only this would be allowed, and
  // the whole reason this test exists is that the rule chosen here is wider.
  const buried = (await post("/api/folders", { name: "Buried", parentFolderId: right.id })).json();

  assert.equal((await patch(`/api/folders/${left.id}`, { name: "Buried" })).statusCode, 409);
  assert.equal((await patch(`/api/folders/${left.id}`, { name: "  buried " })).statusCode, 409);
  assert.equal((await patch(`/api/folders/${left.id}`, { name: "RenameRight" })).statusCode, 409);

  // Renaming to something genuinely free still works, and the buried folder is
  // untouched by any of the refusals.
  assert.equal((await patch(`/api/folders/${left.id}`, { name: "Unclaimed" })).statusCode, 200);
  const tree = (await get("/api/folders")).json();
  const flat: any[] = [];
  const walk = (ns: any[]) => ns.forEach((n) => { flat.push(n); walk(n.children ?? []); });
  walk(tree.folders);
  assert.equal(flat.find((f) => f.id === buried.id).name, "Buried");
  assert.equal(flat.find((f) => f.id === left.id).name, "Unclaimed");
});

test("folder rename: its own name is fine, empty is rejected, and colour-only edits skip the check", async () => {
  const f = (await post("/api/folders", { name: "Solo" })).json();
  assert.equal((await patch(`/api/folders/${f.id}`, { name: "Solo" })).statusCode, 200);
  assert.equal((await patch(`/api/folders/${f.id}`, { name: "   " })).statusCode, 400);
  // No `name` in the body at all — the uniqueness check must not fire and block an
  // ordinary recolour of a folder whose name happens to be a duplicate already.
  const recolour = await patch(`/api/folders/${f.id}`, { color: "#a7f3d0" });
  assert.equal(recolour.statusCode, 200);
  assert.equal(recolour.json().color, "#a7f3d0");
  assert.equal(recolour.json().name, "Solo");
});

// ── T-07 Links + backlinks ─────────────────────────────────────────────────────
test("T-07 links: create, backlinks, self-link rejected, idempotent", async () => {
  const a = (await post("/api/notes", { title: "A", content: doc("a") })).json();
  const b = (await post("/api/notes", { title: "B", content: doc("b") })).json();
  await post(`/api/notes/${a.id}/links`, { targetNoteId: b.id });
  await post(`/api/notes/${a.id}/links`, { targetNoteId: b.id }); // idempotent

  const self = await post(`/api/notes/${a.id}/links`, { targetNoteId: a.id });
  assert.equal(self.statusCode, 400, "self-link rejected");

  const aLinks = (await get(`/api/notes/${a.id}/links`)).json();
  assert.equal(aLinks.links.length, 1);
  assert.equal(aLinks.links[0].id, b.id);
  const bLinks = (await get(`/api/notes/${b.id}/links`)).json();
  assert.equal(bLinks.backlinks[0].id, a.id, "B has A as backlink");
});

// ── T-08 Search ───────────────────────────────────────────────────────────────
test("T-08 search: matches, snippet, excludes locked, empty query", async () => {
  await post("/api/notes", { title: "Pineapple recipe", content: doc("grilled pineapple with honey") });
  const res = (await get("/api/notes/search?q=pineapple")).json();
  assert.ok(res.results.length >= 1);
  assert.match(res.results[0].snippet, /<mark>/i, "snippet is highlighted");

  const empty = (await get("/api/notes/search?q=%20")).json();
  assert.deepEqual(empty.results, [], "blank query returns empty");
});

// ── T-08b Title lookup (note pickers) ─────────────────────────────────────────
// The cases here are the exact ones full-text search cannot answer, which is why
// this endpoint exists. If someone ever "simplifies" the picker back onto
// /notes/search, these fail immediately and say why.
test("T-08b lookup: partial words, stop words, recents, locked titles", async () => {
  const onboarding = (await post("/api/notes", { title: "Why our onboarding drops off", content: doc("funnel") })).json();
  await post("/api/notes", { title: "Kitchen rebuild", content: doc("tiles") });

  // A half-typed word. Full-text search matches whole lexemes and returns nothing
  // here; a picker has to narrow as you type.
  const partial = (await get("/api/notes/lookup?q=onboar")).json();
  assert.ok(partial.results.some((r: any) => r.id === onboarding.id), "matches a partial word");

  // "why" is an English stop word — websearch_to_tsquery strips it and matches
  // nothing, which is what made the picker look broken.
  const stop = (await get("/api/notes/lookup?q=why")).json();
  assert.ok(stop.results.some((r: any) => r.id === onboarding.id), "matches a stop word");

  // Case-insensitive, and mid-title rather than only from the start.
  const mid = (await get("/api/notes/lookup?q=DROPS")).json();
  assert.ok(mid.results.some((r: any) => r.id === onboarding.id), "case-insensitive, matches mid-title");

  // Empty query is a real request: the most recently touched notes, so the picker
  // never opens empty.
  const recents = (await get("/api/notes/lookup")).json();
  assert.ok(recents.results.length > 0, "blank query returns recents");

  // A locked note is still linkable — only its content is withheld, never its title.
  const locked = (await post("/api/notes", { title: "Sealed plans", content: doc("secret") })).json();
  await post(`/api/notes/${locked.id}/lock`, {
    ciphertext: Buffer.from("ciphertext-bytes").toString("base64"),
    cryptoMeta: { kdf: "pbkdf2", salt: "abc", iv: "def", params: { iterations: 600000 } },
  });
  const lockedHit = (await get("/api/notes/lookup?q=Sealed")).json();
  assert.ok(lockedHit.results.some((r: any) => r.id === locked.id), "locked note is findable by title");
  const lockedSearch = (await get("/api/notes/search?q=Sealed")).json();
  assert.equal(lockedSearch.results.length, 0, "...but full-text search still cannot see it");

  const none = (await get("/api/notes/lookup?q=zzzznothing")).json();
  assert.deepEqual(none.results, [], "no match returns empty");
});

// ── T-09 Delete / archive ─────────────────────────────────────────────────────
test("T-09 lifecycle: soft delete, trash, restore, archive, permanent", async () => {
  const n = (await post("/api/notes", { title: "Lifecycle", content: doc("temp") })).json();

  await app.inject({ method: "DELETE", url: `/api/notes/${n.id}` });
  const active = (await get("/api/notes")).json();
  assert.ok(!active.notes.some((x: any) => x.id === n.id), "deleted hidden from active");
  const trash = (await get("/api/notes?filter=trash")).json();
  assert.ok(trash.notes.some((x: any) => x.id === n.id), "appears in trash");

  await post(`/api/notes/${n.id}/restore`);
  const restored = (await get("/api/notes")).json();
  assert.ok(restored.notes.some((x: any) => x.id === n.id), "restored to active");

  await post(`/api/notes/${n.id}/archive`);
  const afterArchive = (await get("/api/notes")).json();
  assert.ok(!afterArchive.notes.some((x: any) => x.id === n.id), "archived hidden from active");
  const arch = (await get("/api/notes?filter=archive")).json();
  assert.ok(arch.notes.some((x: any) => x.id === n.id), "in archive view");

  // Archived remains searchable.
  const search = (await get("/api/notes/search?q=temp")).json();
  assert.ok(search.results.some((x: any) => x.id === n.id), "archived still searchable");

  await post(`/api/notes/${n.id}/unarchive`);
  await app.inject({ method: "DELETE", url: `/api/notes/${n.id}` });
  const perm = await app.inject({ method: "DELETE", url: `/api/notes/${n.id}/permanent` });
  assert.equal(perm.statusCode, 204);
  const gone = await get(`/api/notes/${n.id}`);
  assert.equal(gone.statusCode, 404, "permanently deleted");
});

// ── T-10 Locked notes ─────────────────────────────────────────────────────────
test("T-10 lock: stores ciphertext, redacts content, excluded from search", async () => {
  const n = (await post("/api/notes", { title: "Secret", content: doc("classified passphrase") })).json();
  // Confirm searchable before locking.
  let s = (await get("/api/notes/search?q=classified")).json();
  assert.ok(s.results.some((x: any) => x.id === n.id));

  const locked = (await post(`/api/notes/${n.id}/lock`, {
    ciphertext: Buffer.from("ciphertext-bytes").toString("base64"),
    cryptoMeta: { kdf: "argon2id", salt: "abc", iv: "def", params: { m: 65536 } },
  })).json();
  assert.equal(locked.isLocked, true);
  assert.equal(locked.content, null, "content redacted in response");
  assert.equal(locked.preview, "", "no preview for locked note");
  assert.equal(locked.hasEncryptedContent, true);

  // Excluded from search now.
  s = (await get("/api/notes/search?q=classified")).json();
  assert.ok(!s.results.some((x: any) => x.id === n.id), "locked note not searchable");

  // Ciphertext retrievable for client decryption.
  const ct = (await get(`/api/notes/${n.id}/ciphertext`)).json();
  assert.equal(Buffer.from(ct.ciphertext, "base64").toString(), "ciphertext-bytes");

  // Unlock restores content.
  const unlocked = (await post(`/api/notes/${n.id}/unlock`, { content: doc("classified passphrase") })).json();
  assert.equal(unlocked.isLocked, false);
  assert.equal(unlocked.preview, "classified passphrase");
});

// ── T-11 Import ───────────────────────────────────────────────────────────────
test("T-11 import: CSV preview + commit creates notes, tags, folders", async () => {
  // tags cell holds a comma-separated list, so it must be quoted per CSV rules.
  const csv = 'title,content,tags,folder\nMeeting,Body text here,"work,a",Work/Meetings\nQuick,plain body,,';
  // Build multipart body manually.
  const boundary = "----lockpadtest";
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.csv"\r\n` +
    `Content-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`;

  const preview = await app.inject({
    method: "POST",
    url: "/api/import/preview",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  const pv = preview.json();
  assert.equal(pv.count, 2, "two rows parsed");
  assert.deepEqual(pv.notes[0].tags, ["work", "a"], "tags split from quoted cell");

  // Commit creates the notes, tags, and nested folder path.
  const commit = await app.inject({
    method: "POST",
    url: "/api/import/commit",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  const cm = commit.json();
  assert.equal(commit.statusCode, 201);
  assert.equal(cm.count, 2);
  const meeting = cm.notes.find((n: any) => n.title === "Meeting");
  assert.ok(meeting.folder, "nested folder created + assigned");
  assert.equal(meeting.folder.name, "Meetings");
  assert.equal(meeting.tags.length, 2);

  // Context inheritance: committing from a tag view adds that tag.
  const ctxTag = (await post("/api/tags", { name: "imported" })).json();
  const commit2 = await app.inject({
    method: "POST",
    url: `/api/import/commit?tagId=${ctxTag.id}`,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  const cm2 = commit2.json();
  const quick = cm2.notes.find((n: any) => n.title === "Quick");
  assert.ok(quick.tags.some((t: any) => t.id === ctxTag.id), "inherited tag applied");
});

// ── Card preview fidelity ─────────────────────────────────────────────────────
// A list card renders `previewDoc` through the same TipTap extensions as the
// editor, so anything the toolbar can insert has to SURVIVE the truncation that
// builds it. The trap is that the truncator drops blocks with no text as spacer
// paragraphs — which silently swallowed dividers (and would swallow any future
// text-free node), making a note look different on its card than when opened.
test("card preview keeps inline marks and text-free blocks (divider, image)", async () => {
  const created = await post("/api/notes", {
    title: "Preview fidelity",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "plain " },
            { type: "text", text: "lit", marks: [{ type: "highlight", attrs: { color: "green" } }] },
            { type: "text", text: " bold", marks: [{ type: "bold" }] },
            { type: "text", text: " struck", marks: [{ type: "strike" }] },
          ],
        },
        { type: "horizontalRule" },
        { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "const x = 1;" }] },
      ],
    },
  });
  assert.equal(created.statusCode, 201);

  const preview = created.json().previewDoc as { content: { type: string }[] };
  assert.deepEqual(
    preview.content.map((b) => b.type),
    ["paragraph", "horizontalRule", "codeBlock"],
    "the divider survives truncation instead of being dropped as an empty spacer"
  );

  // The marks ride along on the text nodes — losing them would make the card show
  // unstyled text for anything the toolbar applied.
  const marks = JSON.stringify(preview.content[0]);
  assert.ok(marks.includes("highlight"), "highlight mark preserved");
  assert.ok(marks.includes("green"), "highlight colour preserved");
  assert.ok(marks.includes("bold") && marks.includes("strike"), "bold + strike preserved");

  // The same shape has to come back on the LIST endpoint, not just on create.
  const listed = (await get("/api/notes?filter=active")).json();
  const card = listed.notes.find((n: any) => n.title === "Preview fidelity");
  assert.ok(
    card.previewDoc.content.some((b: any) => b.type === "horizontalRule"),
    "list cards carry the divider too"
  );
});
