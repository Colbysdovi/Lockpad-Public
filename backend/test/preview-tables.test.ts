// What a table looks like on a note card.
//
// Two failures are being guarded against, and neither of them throws.
//
// The first is a table flattening into one run-on line. `makePreviewBlocks` switches
// on block type, and anything it does not recognise falls to a default branch that
// concatenates every text node it can find. For a table that means every cell of
// every row joined end to end — "Option Cost Verdict Self-host Hardware you already
// own Chosen" — which is the table with its shape thrown away.
//
// The second is quieter still. `makePreviewDoc` drops any block whose text is empty,
// because that is how spacer paragraphs are skipped. A table nobody has typed into
// yet has no text at all, so it would vanish from the preview and the card would
// describe a note that does not look like the one you opened. Images, dividers and
// smart links each needed the same exemption for the same reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePreviewBlocks, makePreviewDoc } from "../src/lib/tiptap.js";

type Node = { type: string; content?: Node[]; text?: string };

const cell = (type: "tableHeader" | "tableCell", text?: string): Node => ({
  type,
  content: [text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" }],
});
const headerRow = (...labels: string[]): Node => ({ type: "tableRow", content: labels.map((l) => cell("tableHeader", l)) });
const bodyRow = (...values: string[]): Node => ({ type: "tableRow", content: values.map((v) => cell("tableCell", v)) });
const docWith = (...blocks: Node[]) => ({ type: "doc", content: blocks });

const populated = docWith({
  type: "table",
  content: [
    headerRow("Option", "Cost", "Verdict"),
    bodyRow("Self-host", "Hardware you already own", "Chosen"),
    bodyRow("Managed", "Monthly, forever", "No"),
  ],
});

/** A table with the right shape and not one character typed into it. */
const empty = docWith({
  type: "table",
  content: [
    { type: "tableRow", content: [cell("tableHeader"), cell("tableHeader")] },
    { type: "tableRow", content: [cell("tableCell"), cell("tableCell")] },
  ],
});

test("a table previews as its column headings, not as every cell run together", () => {
  const blocks = makePreviewBlocks(populated);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, "Option · Cost · Verdict");
  // The exact failure this file exists to catch: body cells leaking into the line.
  assert.ok(!blocks[0].text.includes("Self-host"), "body cells must not appear in the preview line");
});

test("a table with no text in it contributes no preview line", () => {
  // Nothing to say about it, so it is skipped the way an empty paragraph is —
  // rather than producing a line of separators with no words between them.
  assert.deepEqual(makePreviewBlocks(empty), []);
});

test("a table survives into the preview document as a real table", () => {
  const out = makePreviewDoc(populated);
  assert.ok(out, "preview doc should not be null");
  const types = (out!.content ?? []).map((n) => n.type);
  assert.deepEqual(types, ["table"]);
});

test("an EMPTY table is kept, not discarded as a spacer", () => {
  // The regression this guards: `isEmpty()` sees no text and drops the block, so a
  // note whose body is a blank table previews as an empty note.
  const out = makePreviewDoc(empty);
  assert.ok(out, "an empty table must still produce a preview document");
  assert.deepEqual((out!.content ?? []).map((n) => n.type), ["table"]);
  assert.equal((out!.content![0].content ?? []).length, 2, "both rows kept");
});

test("a very long table is cut down to a card-sized slice, header row included", () => {
  const rows: Node[] = [headerRow("Name", "Value")];
  for (let i = 0; i < 40; i++) rows.push(bodyRow(`row ${i}`, `${i}`));
  const out = makePreviewDoc(docWith({ type: "table", content: rows }));
  const table = out!.content![0];
  const kept = table.content ?? [];
  assert.ok(kept.length < 40, `expected a truncated table, got ${kept.length} rows`);
  // The first row kept must be the headings, or the slice reads as loose cells.
  assert.equal(kept[0].content![0].type, "tableHeader");
});

test("a table does not crowd out the rest of the note's preview", () => {
  const out = makePreviewDoc(
    docWith(
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      { type: "table", content: [headerRow("A", "B"), bodyRow("1", "2")] },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ),
  );
  assert.deepEqual((out!.content ?? []).map((n) => n.type), ["paragraph", "table", "paragraph"]);
});
