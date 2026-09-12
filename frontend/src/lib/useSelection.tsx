import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { flattenSegments, resolveShiftClick, type RangeSegment } from "./selectionRange";

// Multi-select for the note lists: tick several cards, then act on all of them at
// once from the bulk bar (archive, delete, move to a folder, add a tag).
//
// Deliberately PER PAGE, not global. The provider is mounted inside the list screen
// and keyed by the page, so navigating from a folder to a tag clears the selection
// rather than carrying a hidden set of ticked notes across to a list where those
// notes may not even appear.
//
// Nothing here touches the server — it is purely "which cards are ticked right now".
// The bulk bar reads `selectedIds` and sends them off; `clear()` afterwards.
//
// `selectionMode` is the one derived flag worth knowing about: it turns true the
// moment anything is ticked, and every card's checkbox becomes permanently visible
// instead of hover-only, so the second and third selections don't require hunting
// for an invisible control. It returns to false when the last item is unticked.
//
// ── Ranges: Shift+click ─────────────────────────────────────────────────────
//
// `extendTo` is the Shift+click gesture from Finder, Explorer and Gmail: it selects
// everything between a remembered reference point (the "anchor") and the note just
// clicked. Three pieces of bookkeeping make it work, and all three are explained at
// their definitions below — the anchor, the "base" selection, and the visible order,
// which this module cannot know on its own and has to be told (`setRangeSegment`).
interface SelectionCtx {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  /** Shift+click: select everything between the anchor and `id`, inclusive. */
  extendTo: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  count: number;
  selectionMode: boolean;
  /** Publish one contiguous run of the visible order. See the note on ordering. */
  setRangeSegment: (key: string, rank: number, ids: string[]) => void;
}

// A default value that does nothing, so a card rendered OUTSIDE a provider (the
// print view, and the Archive/Trash pages, which have no selection at all) still
// renders — it simply can never be selected, instead of crashing on an undefined
// context. `setRangeSegment` is a noop here for the same reason: NoteList publishes
// its order unconditionally, including on those pages, and nothing is listening.
const noop = () => {};
const SelectionContext = createContext<SelectionCtx>({
  selectedIds: new Set(),
  toggle: noop,
  extendTo: noop,
  clear: noop,
  isSelected: () => false,
  count: 0,
  selectionMode: false,
  setRangeSegment: noop,
});

export function useSelection(): SelectionCtx {
  return useContext(SelectionContext);
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // ── The three things a range needs, and why none of them is state ──────────
  //
  // All three are refs, and that is a performance decision rather than a style
  // one. The context value's identity is what decides whether every card in a
  // virtualized list of hundreds re-renders (see the useMemo at the bottom), and
  // none of this is ever rendered — it is read imperatively, at the instant of a
  // click. That happens to be exactly what the spec asks for: a range is computed
  // against the live anchor and order at click time, never a snapshot taken
  // earlier in the interaction.
  //
  // `anchor` — the note a range is measured FROM. Set by any plain tick.
  const anchorRef = useRef<string | null>(null);
  //
  // `base` — the selection as it stood before the current run of Shift+clicks.
  //
  // This is what makes a range walkable in both directions. A range ADDS to the
  // selection rather than replacing it, so that hand-picking a couple of notes and
  // then Shift+clicking a run keeps the earlier picks. But if each Shift+click
  // simply added to whatever the last one produced, walking the range back would be
  // impossible: shift-clicking note 10 and then note 5 would leave 6–10 ticked,
  // because nothing ever removes them. So every Shift+click recomputes from `base`
  // instead — the result is always "what was selected before the walk began, plus
  // this click's range", which both keeps the earlier picks and lets the far end of
  // the range move freely.
  const baseRef = useRef<Set<string>>(new Set());
  //
  // `segments` — the visible order, in pieces.
  //
  // A range is "everything between these two notes AS DISPLAYED", and this module
  // has no idea what that order is: the notes come from two independent queries
  // rendered one above the other (the Pinned section, then the main list), each with
  // its own sort. So the components that render them publish their own run of ids
  // and a `rank` saying where it sits vertically, and the ranks are concatenated
  // into one flat order. Pinned notes are rank 0, the main list rank 1, which is
  // what lets a range cross the divider between them — a deliberate product call:
  // the two read as one list with a heading in the middle, so a range spanning them
  // should behave the way it looks.
  const segmentsRef = useRef(new Map<string, RangeSegment>());

  const setRangeSegment = useCallback((key: string, rank: number, ids: string[]) => {
    segmentsRef.current.set(key, { rank, ids });
  }, []);

  // The whole visible order as one flat list. Rebuilt per gesture rather than
  // cached: it is two array copies on a click, and a cache would be one more thing
  // that can go stale while a list is paginating underneath it.
  const flatOrder = useCallback(() => flattenSegments(segmentsRef.current.values()), []);

  // Always builds a NEW Set rather than mutating the existing one: React compares by
  // identity, and mutating in place would leave every consumer showing stale ticks.
  const toggle = useCallback((id: string) => {
    // Any plain tick becomes the new reference point, so the next Shift+click
    // measures from the note the user last touched. Unticking counts too — it is
    // still the user pointing at a note, and leaving the anchor on some older card
    // would make the following range start somewhere they are no longer looking.
    anchorRef.current = id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // A plain tick also ends whatever range walk was in progress and becomes the
      // floor the next one builds on. Assigned in here rather than outside because
      // this is the only place the resulting set exists; re-running the updater with
      // the same `prev` produces the same `next`, so it is safe to repeat.
      baseRef.current = next;
      return next;
    });
  }, []);

  const extendTo = useCallback(
    (targetId: string) => {
      // The decision itself is a pure function (selectionRange.ts) so it can be
      // reasoned about and tested away from React. Everything here is plumbing:
      // read the live anchor, base and order at the instant of the click — which is
      // what "never a snapshot taken earlier in the interaction" requires — hand
      // them over, and write back whatever comes out.
      const order = flatOrder();
      setSelectedIds((prev) => {
        const next = resolveShiftClick({
          order,
          anchor: anchorRef.current,
          base: baseRef.current,
          selected: prev,
          targetId,
        });
        anchorRef.current = next.anchor;
        baseRef.current = next.base;
        return next.selected;
      });
    },
    [flatOrder]
  );

  const clear = useCallback(() => {
    // The range bookkeeping resets with the selection, never separately. An anchor
    // that outlived its selection would silently make the next Shift+click extend
    // from a note the user had already dismissed.
    anchorRef.current = null;
    baseRef.current = new Set();
    setSelectedIds(new Set());
  }, []);

  // Memoised so the context value keeps its identity between renders — without this
  // every card in a virtualized list of hundreds would re-render on any parent
  // render, not just when the selection actually changed. Every callback below is
  // itself stable, which is what keeps the range machinery out of this dependency
  // list entirely.
  const value = useMemo<SelectionCtx>(
    () => ({
      selectedIds,
      toggle,
      extendTo,
      clear,
      isSelected: (id: string) => selectedIds.has(id),
      count: selectedIds.size,
      selectionMode: selectedIds.size > 0,
      setRangeSegment,
    }),
    [selectedIds, toggle, extendTo, clear, setRangeSegment]
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
