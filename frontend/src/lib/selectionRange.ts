// What a Shift+click does to a selection.
//
// Split out of useSelection as a pure function on purpose. The behaviour has more
// cases than it looks like — an absent anchor, an anchor that has left the screen,
// a click above the anchor rather than below, a click on the anchor itself, hand-
// picked notes that must survive, and a range walked backwards that must give notes
// up again — and every one of them is a rule someone asked for rather than an
// accident. Kept here, they can be checked by reading, and checked by running,
// without a browser or a rendered list in the way.
//
// Nothing in this file knows about React, the DOM, or how notes are fetched.

/** One contiguous run of the visible order, as published by whatever renders it. */
export interface RangeSegment {
  /** Vertical position of this run relative to the others. Lower renders first. */
  rank: number;
  /** The ids in this run, in the order they appear on screen. */
  ids: string[];
}

/** Everything a Shift+click needs to know, and everything it changes. */
export interface RangeState {
  /** The ids that should now be selected. */
  selected: Set<string>;
  /** The note the NEXT range measures from. */
  anchor: string;
  /** The selection a following range builds on top of. */
  base: Set<string>;
}

/** The visible order as one flat list: runs sorted by rank, then concatenated.
 *
 *  The notes on screen come from more than one query — the Pinned section renders
 *  above the main list, each with its own sort — so "the order the user sees" only
 *  exists once the runs are stitched together in render order. A range crossing
 *  from one into the other is then just a slice of this array, which is the whole
 *  reason the order is assembled rather than asked for per section. */
export function flattenSegments(segments: Iterable<RangeSegment>): string[] {
  return [...segments].sort((a, b) => a.rank - b.rank).flatMap((s) => s.ids);
}

/** Resolve one Shift+click.
 *
 *  `base` is the selection as it stood before the current run of Shift+clicks — see
 *  useSelection for why it exists. In short: a range is computed from `base` rather
 *  than from the live selection, which is what lets the far end of a range be walked
 *  backwards. Adding to the live selection each time could only ever grow it. */
export function resolveShiftClick({
  order,
  anchor,
  base,
  selected,
  targetId,
}: {
  order: readonly string[];
  anchor: string | null;
  base: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  targetId: string;
}): RangeState {
  // The degraded outcome, used by both "no anchor" cases below: select the one note
  // that was actually clicked, and make it the anchor so the next Shift+click works.
  const justTheTarget = (): RangeState => {
    const next = new Set(selected).add(targetId);
    return { selected: next, anchor: targetId, base: next };
  };

  // Checked before the lookups rather than folded into them, so that `anchor` is
  // genuinely narrowed to a string below instead of being asserted to be one.
  if (anchor === null) return justTheTarget();

  const ti = order.indexOf(targetId);
  const ai = order.indexOf(anchor);

  // An anchor that is no longer in this view — archived, deleted, moved to another
  // folder, or pinned out of the main list since it was set. There is no range to
  // compute, so the gesture degrades the same way as having no anchor at all: select
  // the one note that was clicked, which then becomes the anchor, so a second
  // Shift+click straight afterwards behaves normally.
  //
  // It ADDS rather than replaces, so a fumbled range never costs the user the picks
  // they already made. Never an error, never a silent no-op, and never a range
  // computed against a note that has left the screen.
  //
  // A missing target index should be unreachable — the user just clicked it — but it
  // takes the same path rather than being left to produce a nonsense range if the
  // published order is ever momentarily behind the list.
  if (ai === -1 || ti === -1) return justTheTarget();

  // "Between" is positional: the click can be above or below the anchor.
  const [lo, hi] = ai <= ti ? [ai, ti] : [ti, ai];
  const next = new Set(base);
  for (let i = lo; i <= hi; i++) next.add(order[i]!);
  // The anchor deliberately stays put. It is the fixed end of the range; moving it
  // to each click would make the walk one-way, since a range already applied cannot
  // be taken back by a shorter one measured from its own far end. Clicking the
  // anchor itself gives lo === hi — a range of exactly one note.
  return { selected: next, anchor, base: new Set(base) };
}
