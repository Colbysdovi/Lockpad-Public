// Unit tests for the import parsers.
//
// No database and no server here: the parsers are pure functions from text to
// ParsedNote, so they can be tested directly. That is the payoff for keeping
// lib/import.ts free of any I/O.
//
// Most of these are regression tests against real-world exports — Google Keep's
// HTML, a Lockpad JSON round-trip, dates buried in titles. Other apps' export
// formats are undocumented and inconsistent, so the only reliable specification is
// a sample that once broke.
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToTipTap, parseHtmlFile, parseJsonFile, extractTitleDate } from "../src/lib/import.js";
import { extractPlainText, makePreviewBlocks } from "../src/lib/tiptap.js";

// Find the first node of a given type anywhere in a TipTap doc.
function findType(doc: any, type: string): any {
  if (!doc || typeof doc !== "object") return undefined;
  if (doc.type === type) return doc;
  for (const c of doc.content ?? []) {
    const hit = findType(c, type);
    if (hit) return hit;
  }
  return undefined;
}

// ── Structured preview blocks ────────────────────────────────────────────────
test("makePreviewBlocks echoes task/bullet/ordered/heading structure with checked state", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Groceries" }] },
      { type: "taskList", content: [
        { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Milk" }] }] },
        { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Eggs" }] }] },
      ] },
      { type: "paragraph" }, // empty spacer — must be dropped
      { type: "orderedList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
      ] },
    ],
  };
  const blocks = makePreviewBlocks(doc);
  assert.deepEqual(blocks[0], { type: "heading", text: "Groceries" });
  assert.deepEqual(blocks[1], { type: "task", text: "Milk", checked: false });
  assert.deepEqual(blocks[2], { type: "task", text: "Eggs", checked: true });
  assert.deepEqual(blocks[3], { type: "ordered", text: "first", ordinal: 1 });
  assert.equal(blocks.length, 4, "empty spacer paragraph produced no block");
});

test("makePreviewBlocks caps the number of blocks", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    type: "taskItem", attrs: { checked: false },
    content: [{ type: "paragraph", content: [{ type: "text", text: `item ${i}` }] }],
  }));
  const blocks = makePreviewBlocks({ type: "doc", content: [{ type: "taskList", content: items }] }, 6);
  assert.equal(blocks.length, 6, "respects maxBlocks");
});

// ── HTML ─────────────────────────────────────────────────────────────────────
test("htmlToTipTap converts headings, bold, italic, lists, links", () => {
  const doc = htmlToTipTap(
    `<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> and <a href="https://x.com">link</a>.</p><ul><li>one</li><li>two</li></ul>`
  );
  const h = findType(doc, "heading");
  assert.equal(h.attrs.level, 1);
  assert.equal(extractPlainText(doc).includes("bold"), true);

  const para: any = (doc.content ?? []).find((n: any) => n.type === "paragraph");
  const boldNode = para.content.find((n: any) => n.marks?.some((m: any) => m.type === "bold"));
  assert.ok(boldNode, "has a bold text node");
  const linkNode = para.content.find((n: any) => n.marks?.some((m: any) => m.type === "link"));
  assert.equal(linkNode.marks.find((m: any) => m.type === "link").attrs.href, "https://x.com");

  const list = findType(doc, "bulletList");
  assert.equal(list.content.length, 2);
});

test("htmlToTipTap drops script/style content (safe)", () => {
  const doc = htmlToTipTap(`<p>ok</p><script>window.x=1</script><style>.a{}</style>`);
  const text = extractPlainText(doc);
  assert.equal(text.includes("window.x"), false);
  assert.equal(text.includes(".a{"), false);
  assert.equal(text.includes("ok"), true);
});

test("parseHtmlFile takes the title from <title>, else <h1>, else filename", () => {
  assert.equal(parseHtmlFile("page.html", "<title>My Page</title><p>x</p>").title, "My Page");
  assert.equal(parseHtmlFile("page.html", "<h1>Heading</h1><p>x</p>").title, "Heading");
  assert.equal(parseHtmlFile("notes-export.html", "<p>x</p>").title, "notes-export");
});

test("parseHtmlFile does not leak the <title>/<head> into the body", () => {
  const note = parseHtmlFile("page.html", "<html><head><title>My Page</title></head><body><p>real body</p></body></html>");
  assert.equal(extractPlainText(note.content), "real body");
});

// ── JSON ─────────────────────────────────────────────────────────────────────
test("parseJsonFile: array of note objects with markdown content", () => {
  const notes = parseJsonFile(
    "export.json",
    JSON.stringify([
      { title: "A", content: "# Head\n\nbody", tags: ["x", "y"], folder: "Work/Notes" },
      { title: "B", body: "plain body", tags: "one,two" },
    ])
  );
  assert.equal(notes.length, 2);
  assert.equal(notes[0].title, "A");
  assert.deepEqual(notes[0].tags, ["x", "y"]);
  assert.equal(notes[0].folderPath, "Work/Notes");
  assert.ok(findType(notes[0].content, "heading"), "markdown content became a heading");
  assert.deepEqual(notes[1].tags, ["one", "two"]);
  assert.equal(extractPlainText(notes[1].content), "plain body");
});

test("parseJsonFile: wrapper { notes: [...] }", () => {
  const notes = parseJsonFile("w.json", JSON.stringify({ notes: [{ title: "Z", content: "hi" }] }));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Z");
});

test("parseJsonFile: single note object", () => {
  const notes = parseJsonFile("one.json", JSON.stringify({ title: "Solo", content: "text" }));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Solo");
});

test("parseJsonFile: raw TipTap document uses filename as title and keeps content", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "kept" }] }] };
  const notes = parseJsonFile("my-note.json", JSON.stringify(doc));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "my-note");
  assert.equal(extractPlainText(notes[0].content), "kept");
});

test("parseJsonFile: content as embedded TipTap doc object is preserved", () => {
  const item = { title: "T", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "embedded" }] }] } };
  const notes = parseJsonFile("x.json", JSON.stringify([item]));
  assert.equal(extractPlainText(notes[0].content), "embedded");
});

test("parseJsonFile: invalid JSON throws", () => {
  assert.throws(() => parseJsonFile("bad.json", "{not json"), /Invalid JSON/);
});

test("parseJsonFile: Google Keep export (textContent body + labels tags)", () => {
  const keep = {
    title: " ✅ POST QUOTES 3 : White Fragility 28/06/2020",
    textContent: "🇬🇧 We are born in Racism by default.\n.\n.\n.\n🇫🇷Nous naissons par défaut.\n📸By Guillaume.",
    textContentHtml: "<p><span>ignored because textContent wins</span></p>",
    labels: [{ name: "Social Media" }],
    isArchived: true,
  };
  const notes = parseJsonFile("keep.json", JSON.stringify(keep));
  assert.equal(notes.length, 1);
  const n = notes[0];
  // Title is trimmed and its trailing date is moved to createdAt.
  assert.equal(n.title, "✅ POST QUOTES 3 : White Fragility");
  assert.equal(n.createdAt?.toISOString().slice(0, 10), "2020-06-28");
  // Body came from textContent, split into paragraphs (incl. the "." spacers).
  const text = extractPlainText(n.content);
  assert.ok(text.includes("We are born in Racism"), "EN body present");
  assert.ok(text.includes("Nous naissons"), "FR body present");
  assert.ok(text.includes("By Guillaume"), "credits present");
  const paras = (n.content.content ?? []).filter((c: any) => c.type === "paragraph");
  assert.ok(paras.length >= 5, "line breaks became separate paragraphs");
  // Label became a tag.
  assert.deepEqual(n.tags, ["Social Media"]);
});

test("parseJsonFile: Google Keep checklist (listContent) → taskList with checked state", () => {
  const keep = {
    title: "GOALS ON HOLD",
    labels: [{ name: "Goals" }],
    listContent: [
      { text: "Learn to sail", isChecked: false },
      { text: "Run a marathon", isChecked: true },
      { text: "" },
    ],
  };
  const notes = parseJsonFile("keep.json", JSON.stringify(keep));
  assert.equal(notes.length, 1);
  const n = notes[0];
  assert.equal(n.title, "GOALS ON HOLD");
  assert.deepEqual(n.tags, ["Goals"]);
  // Body is a taskList, not empty.
  const taskList = findType(n.content, "taskList");
  assert.ok(taskList, "checklist became a taskList");
  const items = taskList.content ?? [];
  assert.equal(items.length, 3, "every list item survived");
  assert.equal(items[0].attrs.checked, false);
  assert.equal(items[1].attrs.checked, true);
  const text = extractPlainText(n.content);
  assert.ok(text.includes("Learn to sail") && text.includes("Run a marathon"), "item text present");
});

test("parseJsonFile: falls back to textContentHtml when textContent absent", () => {
  const item = { title: "T", textContentHtml: "<p>hello <strong>world</strong></p>" };
  const notes = parseJsonFile("x.json", JSON.stringify([item]));
  assert.equal(extractPlainText(notes[0].content).trim(), "hello world");
});

test("extractTitleDate parses day-first dates and cleans the title", () => {
  const r = extractTitleDate("✅ POST QUOTES 3 : White Fragility 28/06/2020")!;
  assert.equal(r.title, "✅ POST QUOTES 3 : White Fragility");
  assert.equal(r.date.toISOString().slice(0, 10), "2020-06-28");
  // M/D disambiguation when day > 12.
  assert.equal(extractTitleDate("Note 13/02/2021")!.date.toISOString().slice(0, 10), "2021-02-13");
  // Two-digit year.
  assert.equal(extractTitleDate("x 01/03/21")!.date.toISOString().slice(0, 10), "2021-03-01");
  assert.equal(extractTitleDate("no date here"), null);
});

test("parseJsonFile: date in title moves to createdAt and is stripped from title", () => {
  const notes = parseJsonFile(
    "keep.json",
    JSON.stringify({ title: " ✅ Post 28/06/2020", textContent: "body" })
  );
  assert.equal(notes[0].title, "✅ Post");
  assert.equal(notes[0].createdAt?.toISOString().slice(0, 10), "2020-06-28");
});

test("parseJsonFile: no title date falls back to createdTimestampUsec", () => {
  const notes = parseJsonFile(
    "keep.json",
    JSON.stringify({ title: "No date note", textContent: "body", createdTimestampUsec: 1593294606514000 })
  );
  assert.equal(notes[0].title, "No date note");
  assert.equal(notes[0].createdAt?.toISOString().slice(0, 10), "2020-06-27");
});
