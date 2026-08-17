// Shared helpers for TipTap document JSON. The plaintext extractor here mirrors
// the SQL `lockpad_note_tsv` function used for full-text search, and is the
// single source of truth for note previews (spec §3.1) and import conversion.

export interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
  attrs?: Record<string, unknown>;
  marks?: unknown[];
}

/** An empty TipTap document — used for new/redacted notes. */
export function emptyDoc(): TipTapNode {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/** Recursively concatenate every text node's string into plain text. */
export function extractPlainText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as TipTapNode;
    if (typeof n.text === "string") parts.push(n.text);
    // An inline note-link chip carries its words in an attr rather than in a child
    // text node, so it is invisible to the line above. Without this, "See [chip]"
    // previews as "See", and a paragraph holding ONLY a chip counts as empty — which
    // makes makePreviewDoc discard it as a spacer and the note preview differently
    // from how it reads. Same class of problem the image/divider/smart-link cases
    // below solve, arriving one level further in because this node is inline.
    if (n.type === "noteLink" && typeof n.attrs?.title === "string") parts.push(n.attrs.title);
    // Block-level nodes should read as separate lines in previews.
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Short plaintext excerpt for list cards. */
export function makePreview(doc: unknown, max = 200): string {
  const text = extractPlainText(doc);
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

// A lightweight, glanceable slice of a note's structure for list cards — enough
// to echo the note's shape (checkboxes, bullets, headings) instead of flattening
// everything to plain text.
export type PreviewBlockType = "text" | "heading" | "task" | "bullet" | "ordered" | "quote" | "code";
export interface PreviewBlock {
  type: PreviewBlockType;
  text: string;
  checked?: boolean; // task items only
  ordinal?: number; // ordered-list items only
}

/** Structured preview: the first few top-level blocks, each as one short line.
 *  Mirrors makePreview but keeps just enough structure for a card. Empty blocks
 *  (e.g. spacer paragraphs) are skipped. */
export function makePreviewBlocks(doc: unknown, maxBlocks = 6, maxLen = 140): PreviewBlock[] {
  const root = doc as TipTapNode | undefined;
  if (!root || typeof root !== "object" || !Array.isArray(root.content)) return [];
  const blocks: PreviewBlock[] = [];
  const clip = (s: string) => (s.length > maxLen ? s.slice(0, maxLen).trimEnd() + "…" : s);
  const full = () => blocks.length >= maxBlocks;

  for (const node of root.content) {
    if (full()) break;
    if (!node || typeof node !== "object") continue;
    const n = node as TipTapNode;
    switch (n.type) {
      case "taskList":
      case "bulletList":
      case "orderedList": {
        const kind: PreviewBlockType = n.type === "taskList" ? "task" : n.type === "orderedList" ? "ordered" : "bullet";
        (n.content ?? []).forEach((item, i) => {
          if (full()) return;
          const text = clip(extractPlainText(item));
          if (!text && kind !== "task") return; // keep empty task items (still meaningful), drop empty bullets
          const block: PreviewBlock = { type: kind, text };
          if (kind === "task") block.checked = (item as TipTapNode).attrs?.checked === true;
          if (kind === "ordered") block.ordinal = i + 1;
          blocks.push(block);
        });
        break;
      }
      case "heading": {
        const t = clip(extractPlainText(n));
        if (t) blocks.push({ type: "heading", text: t });
        break;
      }
      case "blockquote": {
        const t = clip(extractPlainText(n));
        if (t) blocks.push({ type: "quote", text: t });
        break;
      }
      case "codeBlock": {
        const t = clip(extractPlainText(n));
        if (t) blocks.push({ type: "code", text: t });
        break;
      }
      default: {
        // paragraph and any other block → its text (skipped when empty).
        const t = clip(extractPlainText(n));
        if (t) blocks.push({ type: "text", text: t });
      }
    }
  }
  return blocks;
}

/** A bounded, render-ready slice of the note's document: the first few meaningful
 *  top-level blocks, keeping the *real* node structure (heading levels, inline
 *  marks, list grouping) rather than flattening to lines. This lets a list card
 *  render its preview through the exact same editor extensions + `.ProseMirror`
 *  styling as the detail page. Leading/empty spacer blocks are skipped and lists
 *  are truncated to fit the block budget. Returns null when there's nothing to show. */
export function makePreviewDoc(doc: unknown, maxBlocks = 6): TipTapNode | null {
  const root = doc as TipTapNode | undefined;
  if (!root || typeof root !== "object" || !Array.isArray(root.content)) return null;
  const isEmpty = (n: TipTapNode) => extractPlainText(n).trim() === "";
  const out: TipTapNode[] = [];
  let budget = maxBlocks;

  for (const node of root.content) {
    if (budget <= 0) break;
    if (!node || typeof node !== "object") continue;
    const n = node as TipTapNode;
    if (n.type === "taskList" || n.type === "bulletList" || n.type === "orderedList") {
      const items = (n.content ?? []).filter((it): it is TipTapNode => !!it && typeof it === "object");
      // Keep empty task items (a bare checkbox still reads as structure); drop
      // empty bullets/numbers. Truncate to what's left of the block budget.
      const kept = (n.type === "taskList" ? items : items.filter((it) => !isEmpty(it))).slice(0, budget);
      if (kept.length === 0) continue;
      out.push({ ...n, content: kept });
      budget -= kept.length;
    } else if (n.type === "image" || n.type === "horizontalRule") {
      // Neither an image nor a divider carries any text, so the emptiness test below
      // would throw both away as spacers — a note whose first block is a photo would
      // preview as blank, and a divider (the toolbar/slash "Divider" action) would
      // simply never appear on a card, making the note look different from itself.
      out.push(n);
      budget -= 1;
    } else if (n.type === "smartLink") {
      // A smart-link is an atom whose meaning lives in its attrs (url/provider), not
      // in child text — so the isEmpty() text check below would wrongly drop it as a
      // spacer. Keep it: the card renders it through the same SmartLink node.
      out.push(n);
      budget -= 1;
    } else {
      if (isEmpty(n)) continue; // spacer paragraphs / empty blocks
      out.push(n);
      budget -= 1;
    }
  }

  if (out.length === 0) return null;
  return { type: "doc", content: out };
}

/** Build a minimal TipTap doc from a plain-text string (one paragraph per line). */
export function docFromPlainText(text: string): TipTapNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const content: TipTapNode[] = lines.map((line) =>
    line.length
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph" }
  );
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
