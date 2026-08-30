import type { ReactNode } from "react";

// Sentences with something OTHER than text inside them.
//
// A keycap, a bolded term, an icon — these are React nodes, so the sentence around
// them cannot simply be handed to `t()` and rendered. The naive fix is to translate
// the fragments either side and concatenate, which works until a language wants the
// node somewhere else in the sentence, and then it is unfixable without touching
// every call site.
//
// So the catalogue keeps ONE string with a placeholder, `t()` substitutes a marker
// no translator will ever type, and the marker is split out and the node dropped in
// where the language put it. The placeholder's position stays the language's
// business, which is the whole point.

/** A character that cannot appear in real copy, used to mark where a node goes. */
export const SLOT = "\u0000";

/**
 * Render a translated sentence with a React node standing in for its placeholder.
 *
 *     withSlot(t("composer.hint.save", { key: SLOT }), <kbd>Enter</kbd>)
 */
export function withSlot(sentence: string, node: ReactNode): ReactNode {
  const [before, after = ""] = sentence.split(SLOT);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}

/**
 * The same idea for a sentence with SEVERAL nodes in it.
 *
 * Every placeholder is substituted with the same marker, so the nodes are placed in
 * the order the markers appear in the TRANSLATED string — which is the correct
 * semantics rather than a convenience: if a language reorders the two, the nodes
 * follow it.
 *
 *     withSlots(t("k", { term: SLOT, action: SLOT }), <b>a</b>, <b>b</b>)
 */
export function withSlots(sentence: string, ...nodes: ReactNode[]): ReactNode {
  const parts = sentence.split(SLOT);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < nodes.length ? nodes[i] : null}
        </span>
      ))}
    </>
  );
}
