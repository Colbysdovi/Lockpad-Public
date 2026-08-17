// The highlighter's colour set.
//
// Deliberately SMALL — five colours, not a picker. A highlight is a flag ("come
// back to this"), and a flag only works while the number of things it can mean
// stays small; an arbitrary colour wheel turns it into decoration. Five is enough
// for a personal taxonomy and few enough to fit one row of swatches on a phone.
//
// The keys are borrowed from the note-colour palette (lib/noteColors.ts) on
// purpose, so "amber" means the same family whether it is a note's accent or a
// highlighted sentence — but the VALUES are their own CSS variables (`--hl-<key>`
// in index.css), because a note accent is a saturated line and a highlight is a
// translucent wash that text has to stay readable through. Both are theme-aware,
// which is the reason a colour is stored by NAME rather than as a hex value: a
// pale yellow baked into the document would be invisible on the dark surface.

export const HIGHLIGHT_COLORS = [
  { key: "amber", label: "Yellow" },
  { key: "green", label: "Green" },
  { key: "blue", label: "Blue" },
  { key: "pink", label: "Pink" },
  { key: "purple", label: "Purple" },
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]["key"];

/** The colour used when none is chosen — a plain "highlight this" with no meaning
 *  attached beyond emphasis. Also what an imported `==marked==` span becomes. */
export const DEFAULT_HIGHLIGHT: HighlightColor = "amber";

const KEYS = new Set<string>(HIGHLIGHT_COLORS.map((c) => c.key));

/** Narrow anything stored in a document to a colour this build knows how to draw.
 *  A note written by a future version with a colour we have since dropped still
 *  renders — as the default — rather than losing its highlight altogether. */
export function asHighlightColor(value: unknown): HighlightColor {
  return typeof value === "string" && KEYS.has(value) ? (value as HighlightColor) : DEFAULT_HIGHLIGHT;
}

/** The CSS custom property backing a colour (theme-aware; see index.css). */
export function highlightVar(color: HighlightColor): string {
  return `var(--hl-${color})`;
}
