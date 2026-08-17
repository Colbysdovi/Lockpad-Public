// Turning a note's document into the plain sentence a card shows.
//
// This is a deliberate DUPLICATE of backend/src/lib/tiptap.ts. The server computes
// the real preview when it saves, but the list card needs to update on every
// keystroke, long before any save has come back — so the same reduction runs here
// to fill the gap optimistically. Keeping the two implementations identical is what
// stops the card's text flickering between a local guess and the server's answer
// when the save lands. If one changes, change the other.
//
// The server's response is still the source of truth and quietly corrects any
// drift; this is a stand-in, not an authority.

interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
  attrs?: Record<string, unknown>;
}

/** Every piece of text in the document, in order, whitespace collapsed. Walks the
 *  node tree rather than assuming a shape, so unknown node types (smart links, code
 *  blocks, anything added later) contribute their text without special cases. */
export function extractPlainText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as TipTapNode;
    if (typeof n.text === "string") parts.push(n.text);
    // An inline note-link chip keeps its words in an attr, not in a child text node,
    // so the line above cannot see them. Without this the optimistic preview reads
    // "See" where the note reads "See [chip]" — and the server's copy, which does
    // handle it, would correct the card a moment later. That visible correction is
    // exactly the flicker this duplicate exists to prevent.
    if (n.type === "noteLink" && typeof n.attrs?.title === "string") parts.push(n.attrs.title);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** The same text, truncated for a card. Cuts on a character count rather than a
 *  word boundary — the card also clamps by line, so the exact cut is never seen. */
export function makePreview(doc: unknown, max = 200): string {
  const text = extractPlainText(doc);
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}
