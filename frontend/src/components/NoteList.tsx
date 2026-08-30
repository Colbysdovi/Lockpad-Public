import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { NotebookPen, Plus } from "@/components/icons";
import { useNotesList, type ListParams } from "@/lib/hooks";
import { useNewNote } from "@/lib/useNewNote";
import { useNoteSheet } from "@/lib/useNoteSheet";
import { hasArrival, consumeArrival, isJustCreated } from "@/lib/noteFx";
import { CARD_ARRIVE_MS, EASE_FOLLOW } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { NoteCard } from "./NoteCard";
import { cn } from "@/lib/utils";
import type { NoteCard as NoteCardType } from "@/lib/types";
import { useT } from "@/lib/i18n";

// Virtualized, cursor-paginated note list (spec §3.1). Lays notes out as a
// multi-column card grid (virtualized via lanes). Auto-loads the next 50 on
// scroll-to-end, plus an explicit button, and announces batches.
//
// `footer` renders inside the scroll container, below the notes (and below the
// empty state) — used to hang a contextual "Archived" section under the active
// list on folder/tag pages so both share a single natural scroll.

// Imperative handle: lets a parent (e.g. the "Back to top" affordance in
// ListScreen) drive the internal scroll container it doesn't own.
export interface NoteListHandle {
  scrollToTop: () => void;
}

// Once the list has scrolled past roughly the first row of cards, the first notes
// are out of view — the threshold that reveals the "Back to top" button.
const DEEP_SCROLL_PX = 260;


interface NoteListProps {
  params: ListParams;
  emptyLabel?: string;
  // `header` renders inside the scroll container above the notes (the "Pinned"
  // section); `footer` renders below them (the "Archived" section). `scope`
  // threads the page's pin scope to each card's pin toggle.
  header?: ReactNode;
  footer?: ReactNode;
  scope?: string;
  // Reports whether the list has scrolled away from the top, so the page can fade
  // in the top-of-list gradient (fires only on the boolean's edge, not per frame).
  onScrolled?: (scrolled: boolean) => void;
  // Reports whether the list has scrolled far enough that the first notes have left
  // the viewport (edge-triggered, like onScrolled) — drives the "Back to top" button.
  onDeepScroll?: (deep: boolean) => void;
}

export const NoteList = forwardRef<NoteListHandle, NoteListProps>(function NoteList({
  params,
  emptyLabel,
  header,
  footer,
  scope,
  onScrolled,
  onDeepScroll,
}, ref) {
  const t = useT();
  const filter = params.filter ?? "active";
  const query = useNotesList(params);
  const parentRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  const deepRef = useRef(false);
  const reduceMotion = useReducedMotion();

  // The cards cascade in when the list first mounts (i.e. right after a page
  // transition). `entering` gates that stagger to the initial paint only — once
  // it flips off, rows virtualized in during scrolling render statically instead
  // of re-animating every time they re-enter the overscan window. Exit is not
  // gated: when the page unmounts, the ancestor <AnimatePresence> (Layout) drives
  // each visible row's `exit`, so the notes slide away one by one on navigation.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 700);
    return () => clearTimeout(t);
  }, []);

  const handleScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const s = el.scrollTop > 8;
    if (s !== scrolledRef.current) {
      scrolledRef.current = s;
      onScrolled?.(s);
    }
    const d = el.scrollTop > DEEP_SCROLL_PX;
    if (d !== deepRef.current) {
      deepRef.current = d;
      onDeepScroll?.(d);
    }
  };

  useImperativeHandle(ref, () => ({
    scrollToTop: () => parentRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }),
  }), [reduceMotion]);
  const { createNote } = useNewNote();
  const [columns, setColumns] = useState(1);

  // Create's "arrive" gate (micro-interactions-create-prd.md): a note that is being
  // composed right now — open in the sheet, still with no title and no content — is
  // held OUT of the list, so an empty card never flashes in next to populated ones.
  // It joins the list (animating in) the moment it has real content, which the
  // optimistic autosave patch delivers on the first keystroke. Notes left blank and
  // closed reappear as ordinary "Untitled" cards rather than being hidden for good —
  // hiding a real row permanently would make it unreachable.
  const allNotes: NoteCardType[] = query.data?.pages.flatMap((p) => p.notes) ?? [];
  const { noteId: openNoteId } = useNoteSheet();
  // "Blank" = nothing the user has actually written. A new note is created with the
  // backend's DEFAULT title ("Untitled", see schemas.ts) rather than an empty string,
  // so that placeholder counts as blank too — otherwise every new note would look
  // like it already had a title and the gate would never engage.
  const isBlank = (n: NoteCardType) => {
    const t = n.title.trim();
    return (t === "" || t === "Untitled") && n.previewDoc == null;
  };
  const composingId =
    (openNoteId && allNotes.some((n) => n.id === openNoteId && isBlank(n)) ? openNoteId : null) ??
    // Covers the gap between "created" and "sheet reports it open".
    (allNotes.find((n) => isBlank(n) && isJustCreated(n.id))?.id ?? null);
  const notes: NoteCardType[] = composingId ? allNotes.filter((n) => n.id !== composingId) : allNotes;

  // A note that was being composed and has just gained content gets one render with
  // the arrival animation. The "owed an arrival" registry is module-level so it
  // survives the page remount that opening the note sheet causes.
  //
  // A SET of arriving notes, not one — and each with its own timer.
  //
  // The composer's plain Enter creates a note without opening it, which makes firing
  // several captures in a row a normal thing to do rather than a stress test. Held
  // as a single id, the second note's arrival simply overwrote the first: one shared
  // timer, one slot, so a note created 200ms after another had its 420ms animation
  // cut off partway and the two signals blurred into one indistinguishable pulse —
  // exactly what "did that second one save?" feels like. Every arrival now runs to
  // completion independently of whatever arrives next.
  //
  // For the same reason the timers are NOT cleaned up when this effect re-runs. An
  // effect cleanup keyed on `idsKey` would cancel the first card's timer the moment
  // a second note changed the list, which is the collision arriving by another door.
  // A timer belongs to one note's animation and outlives any number of list changes;
  // only unmounting cancels them.
  const [arrivingIds, setArrivingIds] = useState<ReadonlySet<string>>(() => new Set());
  const arriveTimers = useRef(new Map<string, number>());
  const idsKey = notes.map((n) => n.id).join(",");
  useEffect(() => {
    // Every note owed an arrival, not just the first: two creates landing in the
    // same refetch used to leave one of them animating and the other appearing from
    // nowhere.
    const owed = notes.filter((n) => hasArrival(n.id));
    if (!owed.length) return;
    owed.forEach((n) => consumeArrival(n.id));
    setArrivingIds((prev) => {
      const next = new Set(prev);
      owed.forEach((n) => next.add(n.id));
      return next;
    });
    owed.forEach((n) => {
      const t = window.setTimeout(() => {
        arriveTimers.current.delete(n.id);
        setArrivingIds((prev) => {
          if (!prev.has(n.id)) return prev;
          const next = new Set(prev);
          next.delete(n.id);
          return next;
        });
      }, CARD_ARRIVE_MS + 20);
      arriveTimers.current.set(n.id, t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // The one place the timers are cancelled: this list going away. Without it, a
  // navigation during an arrival leaves a timer holding a setState on an unmounted
  // component, and enough of them leak.
  useEffect(() => {
    const timers = arriveTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // Lays out in as many columns as the container fits (min 260px each).
  // Depends on `isLoading` too: while loading/empty the component early-returns
  // markup without `parentRef`, so the observer can't attach — re-run once the
  // real list (and its scroll container) has mounted. The 0-width guard ignores
  // spurious reports the ResizeObserver emits while the container is hidden.
  //
  // The column count is applied IMMEDIATELY on mount but DEBOUNCED on subsequent
  // resizes: while the sidebar collapse animates the container's width every frame,
  // recomputing the count mid-animation would snap the cards to a new column layout
  // partway through — the "junky" jump. Instead we hold the current columns (cards
  // just stretch via `1fr`, which is smooth) and re-column once ONCE the width has
  // settled (i.e. after the animation completes).
  useLayoutEffect(() => {
    const apply = () => {
      const w = parentRef.current?.clientWidth ?? 0;
      if (w === 0) return;
      setColumns(Math.max(1, Math.floor(w / 340)));
    };
    apply();
    let settle: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = setTimeout(apply, 180);
    });
    if (parentRef.current) ro.observe(parentRef.current);
    return () => { ro.disconnect(); clearTimeout(settle); };
  }, [query.isLoading]);

  const rowCount = Math.ceil(notes.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 260,
    overscan: 6,
    gap: 16,
  });

  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (!last) return;
    if (last.index >= rowCount - 1 && query.hasNextPage && !query.isFetchingNextPage) {
      query.fetchNextPage();
    }
  }, [items, rowCount, query]);

  if (query.isLoading) return <div className="p-8 text-center text-muted-foreground">{t("list.loading")}</div>;
  if (query.isError) return <div className="p-8 text-center text-destructive">{t("list.loadFailed")}</div>;

  return (
    <div className="flex h-full flex-col">
      {/* pt-2 leaves room for the first row's hover lift (-2px) + ring so it
          isn't clipped by overflow-auto against the container's top edge. */}
      {/* pb comes from --list-bottom-inset, not a number picked here. The composer and
          the Back to top button float over this list without being in its flow, so the
          scroller has to reserve their height itself — and when that reservation was a
          literal (pb-28) it went stale the moment the button was added, leaving it
          sitting on top of "End of list". See the token's note in index.css. */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto overscroll-contain px-4 pt-2"
        style={{ paddingBottom: "var(--list-bottom-inset)" }}
      >
        {/* Pinned section (if any) sits above the regular list, same scroll. */}
        {header}
        {notes.length === 0 ? (
          // Empty active list. When a header/footer (pinned/archived section) is
          // present it must stay visible, so top-align instead of full-height.
          <div className={cn("flex flex-col items-center justify-center gap-4 p-8 text-center", header || footer ? "pt-10" : "h-full")}>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <NotebookPen className="h-7 w-7" />
            </div>
            <p className="text-muted-foreground">{emptyLabel ?? t("list.empty")}</p>
            {filter === "active" && (
              <Button onClick={createNote} className="gap-1.5">
                <Plus className="h-4 w-4" /> {t("header.newNote")}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {items.map((vr, i) => {
                const start = vr.index * columns;
                const rowNotes = notes.slice(start, start + columns);
                // `i` is the on-screen order of this row (not vr.index, which grows
                // with scrolling) — so both the enter cascade and the exit fall are
                // staggered top-first regardless of scroll position.
                const enterDelay = entering ? Math.min(i, 10) * 0.03 : 0;
                const exitDelay = Math.min(i, 5) * 0.03;
                return (
                  <div
                    key={vr.key}
                    data-index={vr.index}
                    ref={virtualizer.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vr.start}px)` }}
                  >
                    {/* Positioning stays on the outer div (virtualizer owns its
                        transform); this inner layer owns the animation transform so
                        the two never collide. */}
                    <motion.div
                      initial={reduceMotion || !entering ? false : { opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_FOLLOW, delay: enterDelay } }}
                      exit={
                        reduceMotion
                          ? { opacity: 0, transition: { duration: 0.15 } }
                          : { opacity: 0, y: 26, transition: { duration: 0.26, ease: EASE_FOLLOW, delay: exitDelay } }
                      }
                    >
                      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                        {rowNotes.map((note, col) => (
                          <NoteCard key={note.id} note={note} filter={filter} scope={scope} index={start + col} arriving={arrivingIds.has(note.id)} />
                        ))}
                      </div>
                    </motion.div>
                  </div>
                );
              })}
            </div>

            {/* Load-more sits right after the last loaded note and scrolls with the
                list — it is not a fixed footer (spec). */}
            <div className="flex justify-center py-4">
              {query.hasNextPage ? (
                <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                  {query.isFetchingNextPage ? t("list.loadingMore") : t("list.loadMore")}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t("list.end")}</span>
              )}
            </div>
          </>
        )}

        {footer}
      </div>

      <div aria-live="polite" className="sr-only">{t("list.loadedAnnouncement", { count: notes.length })}</div>
    </div>
  );
});
