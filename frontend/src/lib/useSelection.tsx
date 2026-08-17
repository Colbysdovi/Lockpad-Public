import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

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
interface SelectionCtx {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  count: number;
  selectionMode: boolean;
}

// A default value that does nothing, so a card rendered OUTSIDE a provider (the
// pinned section on some pages, the print view) still renders — it simply can never
// be selected, instead of crashing on an undefined context.
const noop = () => {};
const SelectionContext = createContext<SelectionCtx>({
  selectedIds: new Set(),
  toggle: noop,
  clear: noop,
  isSelected: () => false,
  count: 0,
  selectionMode: false,
});

export function useSelection(): SelectionCtx {
  return useContext(SelectionContext);
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Always builds a NEW Set rather than mutating the existing one: React compares by
  // identity, and mutating in place would leave every consumer showing stale ticks.
  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelectedIds(new Set()), []);

  // Memoised so the context value keeps its identity between renders — without this
  // every card in a virtualized list of hundreds would re-render on any parent
  // render, not just when the selection actually changed.
  const value = useMemo<SelectionCtx>(
    () => ({
      selectedIds,
      toggle,
      clear,
      isSelected: (id: string) => selectedIds.has(id),
      count: selectedIds.size,
      selectionMode: selectedIds.size > 0,
    }),
    [selectedIds, toggle, clear]
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
