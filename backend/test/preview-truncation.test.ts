// Preview truncation, at the boundary.
//
// The bug being tested for is narrow and silent: `.slice(0, n)` counts UTF-16 code
// units rather than characters, so a cut can land INSIDE a character. Nothing throws
// and nothing is lost from the note — one glyph at the end of an already-shortened
// line renders wrong, and nobody reports it.
//
// Every case here is constructed so the cut falls exactly on the seam. A test that
// merely truncated a long ASCII string would pass against the broken implementation
// and prove nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePreview, makePreviewBlocks } from "../src/lib/tiptap.js";

/** A doc whose only text is `text`. */
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Does this string contain half of a surrogate pair with nothing to pair with? */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++; // consumed the pair
    } else if (isLow) {
      return true; // a low surrogate with no high before it
    }
  }
  return false;
}

test("an emoji is never cut in half", () => {
  // "🇫🇷" and most emoji are two code units. Put one so that the limit falls between
  // its halves: nine ASCII characters, then the emoji, cut at ten.
  const text = "abcdefghi🙂 and more text after the boundary";
  const preview = makePreview(doc(text), 10);

  assert.ok(!hasLoneSurrogate(preview), `preview contains a broken character: ${JSON.stringify(preview)}`);
  assert.ok(
    !preview.includes("�"),
    "a lone surrogate renders as the replacement character once it round-trips through JSON"
  );
});

test("a combining accent is never separated from its letter", () => {
  // NFD: "e" followed by U+0301 COMBINING ACUTE ACCENT — two code units for one
  // character the reader sees. The limit lands between them.
  const decomposed = "Caf" + "é" + " du coin, et une longue suite de mots";
  assert.equal(decomposed.normalize("NFD"), decomposed, "the fixture must genuinely be decomposed");

  const preview = makePreview(doc(decomposed), 4);

  // Four characters, as a reader counts them, is "Café" — accent included. Counting
  // code units instead takes "C", "a", "f", "e" and leaves the combining accent
  // behind, so the preview reads "Cafe" and the word is misspelled rather than
  // merely shortened. That is the exact regression this asserts against.
  const beforeEllipsis = preview.replace(/…$/, "");
  assert.equal(
    [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(beforeEllipsis)].length,
    4,
    `expected four user-perceived characters, got ${JSON.stringify(beforeEllipsis)}`
  );
  assert.equal(beforeEllipsis.normalize("NFC"), "Café", `the accent was lost or orphaned: ${JSON.stringify(preview)}`);
  // And the mark must never lead, which is what a cut landing before its base letter
  // would produce — it would then attach itself to whatever follows, the ellipsis
  // included.
  assert.ok(!/^[\u0300-\u036f]/.test(beforeEllipsis), "a combining mark was left without its letter");
});

test("ordinary text truncates exactly as before", () => {
  // The regression guard. Precomposed accents are one code unit each, so French
  // written normally must be unaffected by any of this.
  const text = "Réunion d'équipe à propos du déploiement de la semaine prochaine";
  assert.equal(text.normalize("NFC"), text, "the fixture must be precomposed, as ordinary input is");

  assert.equal(makePreview(doc(text), 8), "Réunion…");
  assert.equal(makePreview(doc(text), 1000), text, "short enough to fit is returned untouched");
});

test("structured previews clip on the same boundary rule", () => {
  const text = "abcdefghi🙂 trailing content well past the limit";
  const blocks = makePreviewBlocks(
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
    6,
    10
  );
  assert.equal(blocks.length, 1);
  assert.ok(!hasLoneSurrogate(blocks[0].text), `block preview contains a broken character: ${JSON.stringify(blocks[0].text)}`);
});

test("the preview never grows past the limit it was given", () => {
  // Counting graphemes rather than code units must not turn into counting MORE of
  // them: a preview that lengthened would change how cards lay out.
  const text = "🙂".repeat(50);
  const preview = makePreview(doc(text), 10);
  assert.ok(preview.length <= 10 * 2 + 1, `preview is longer than 10 emoji plus an ellipsis: ${preview.length}`);
  assert.equal([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(preview)].length, 11);
});
