import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Eye, Archive, Copy, Folder, Trash2, RotateCcw, ArchiveRestore, XCircle, Pin, Check, Download, FileText, Printer } from "@/components/icons";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Tooltip } from "@/components/ui/tooltip";
import { FolderSelect, TagMultiSelect } from "./selectors";
import { NotePreview } from "./NotePreview";
import { LockDialog, type LockMode } from "./LockPanel";
import { useFolderAccent } from "@/lib/folderColor";
import type { NoteCard as NoteCardType, Note } from "@/lib/types";
import { useNoteAction, useQuietNoteActions, useDuplicateNote, useUpdateNote, useTagActions, usePinActions, useInvalidateNotes } from "@/lib/hooks";
import type { ListFilter } from "@/lib/hooks";
import { useNoteSheet } from "@/lib/useNoteSheet";
import { useSelection } from "@/lib/useSelection";
import { useLongPress } from "@/lib/useLongPress";
import { useToast } from "@/lib/useToast";
import { api } from "@/lib/api";
import { exportNoteAsMarkdown, exportNoteAsPdf } from "@/lib/noteExport";
import { useNoteHighlight, useLandingHidden, useReflowFlip, useLockFx, flyCard, landFly, highlightNote, findCardEl, findLandingEl, rectOf, takeReturn, useBulkExit, markLanding, revealLanding, type FlyRect, type UndoKind } from "@/lib/noteFx";
import {
  EASE_END,
  EASE_FOLLOW,
  ARCHIVE_RECEDE_MS,
  ARCHIVE_TOTAL_MS,
  ARCHIVE_FADE_MS,
  DELETE_STRIKE_MS,
  DELETE_HOLD_MS,
  DELETE_PEEL_MS,
  REDUCED_FADE_MS,
  REFLOW_MS,
  ACCENT_DRAW_MS,
  ACCENT_ERASE_MS,
  LOCK_BLUR_MS,
  LOCK_REVEAL_MS,
  CARD_ARRIVE_MS,
  flyRevealMs,
  flyHighlightMs,
  DELETE_BULK_STAGGER_MS,
  SPRING_ANSWER,
  DELETE_BULK_STAGGER_CAP,
  UNDO_BULK_STAGGER_MS,
  UNDO_BULK_STAGGER_CAP,
  exitDurationMs,
  undoDurationMs,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// One icon button in the bottom action bar.
function BarButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "card-action-btn inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
          danger && "hover:text-destructive"
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function NoteCard({
  note,
  filter,
  scope,
  pinned = false,
  index = 0,
  arriving = false,
}: {
  note: NoteCardType;
  filter: ListFilter;
  // Position in its container, used only to cap-stagger the accent redraw when a
  // whole folder is recoloured at once (so it never reads as a flashbang).
  index?: number;
  // True for the one render in which a just-composed note joins the list, so it
  // animates in instead of popping (see NoteList's blank-note gate).
  arriving?: boolean;
  // Pin scope for the current page ("all" | "folder:<id>" | "tag:<id>"). When
  // set (list views, active notes only) a pin toggle appears top-right.
  scope?: string;
  pinned?: boolean;
}) {
  const actions = useNoteAction();
  const quiet = useQuietNoteActions();
  const duplicate = useDuplicateNote();
  const updateNote = useUpdateNote();
  const tagActions = useTagActions();
  const pinActions = usePinActions();
  const selection = useSelection();
  const toast = useToast();
  const { openNote } = useNoteSheet();
  const canPin = !!scope && filter === "active";
  const canSelect = filter === "active";
  const selected = selection.isSelected(note.id);
  // The accent strip is DERIVED from the note's folder (nearest colored ancestor) —
  // colour now means "which folder", not a freeform per-note choice. null → no strip.
  const accent = useFolderAccent(note.folder?.id);
  const reduceMotion = useReducedMotion();

  // Colour's "mark" axis: the strip draws on when the note gains a colour, retracts
  // when it loses one, and erases-then-redraws when it changes — so a folder move
  // reads as a deliberate update rather than a flicker. `key` restarts the CSS
  // animation; `phase` picks which one plays.
  const [strip, setStrip] = useState<{ color: string | null; phase: "none" | "draw" | "erase"; key: number }>(
    { color: accent, phase: "none", key: 0 }
  );
  const prevAccent = useRef(accent);
  useEffect(() => {
    const prev = prevAccent.current;
    if (accent === prev) return;
    prevAccent.current = accent;
    if (reduceMotion) {
      setStrip((s) => ({ color: accent, phase: "none", key: s.key + 1 }));
      return;
    }
    if (!prev && accent) {
      setStrip((s) => ({ color: accent, phase: "draw", key: s.key + 1 }));
      return;
    }
    // Retract what's there first; then either stop (cleared) or draw the new colour.
    // The handoff waits exactly one erase — same constant the CSS animation runs on,
    // so the old colour has finished retracting the instant the new one starts.
    setStrip((s) => ({ color: prev, phase: "erase", key: s.key + 1 }));
    const t = window.setTimeout(
      () => setStrip((s) => (accent ? { color: accent, phase: "draw", key: s.key + 1 } : { color: null, phase: "none", key: s.key + 1 })),
      ACCENT_ERASE_MS
    );
    return () => window.clearTimeout(t);
  }, [accent, reduceMotion]);
  const invalidateNotes = useInvalidateNotes();
  // Post-arrival attention pulse (a duplicate settling into the list).
  const highlighted = useNoteHighlight(note.id);
  // True when this card is the DESTINATION of a clone that is still in the air: it
  // holds its slot open (so the neighbours have already reflowed and the gap the
  // clone is flying into is real) but stays invisible and inert until it arrives.
  const landingHidden = useLandingHidden(note.id);

  // Exit choreography (delete "peel" / archive "recede"). The card animates ITSELF
  // out while the API request flies in parallel — the animation never waits on the
  // network — and only once it has finished do we reconcile the cache, which is what
  // finally unmounts the card. Reconciling eagerly would yank the card out from under
  // its own animation.
  // `bulk` is carried alongside the kind because a bulk removal is not merely the
  // single-card one repeated: delete drops the strikethrough (twelve of them drawing
  // at once reads as noise, not as emphasis) and staggers the peel instead.
  const [exiting, setExiting] = useState<null | { kind: "delete" | "archive"; bulk: boolean }>(null);

  const playExit = (kind: "delete" | "archive", request: Promise<unknown>, onDone: () => void) => {
    setExiting({ kind, bulk: false });
    const settled = request.catch(() => {});
    const ms = exitDurationMs(kind, { reduced: !!reduceMotion });
    const played = new Promise((r) => window.setTimeout(r, ms));
    void Promise.all([settled, played]).then(() => {
      invalidateNotes();
      onDone();
    });
  };

  // Told to leave by the bulk bar, which has no handle on this card. The card plays
  // exactly the exit it would have played from its own action bar; only the timing
  // differs (see the `bulk` flag above). The request and the cache reconcile are the
  // bar's business — this card just performs.
  const bulkExit = useBulkExit(note.id);
  useEffect(() => {
    if (bulkExit && !exiting) setExiting({ kind: bulkExit, bulk: true });
  }, [bulkExit, exiting]);

  // Undo choreography. A card whose removal was just undone claims its owed rewind
  // on MOUNT — this component IS the restored card, freshly mounted by the refetch
  // that the undo triggered, so there is no earlier hook to hang it on. Claiming in
  // the initializer (not an effect) means the very first paint already carries the
  // animation class, so the card never flashes in place before rewinding.
  const [returning, setReturning] = useState<UndoKind | null>(() => takeReturn(note.id));
  useEffect(() => {
    if (!returning) return;
    const t = window.setTimeout(
      () => setReturning(null),
      undoDurationMs(returning, { reduced: !!reduceMotion }) + Math.min(index, UNDO_BULK_STAGGER_CAP) * UNDO_BULK_STAGGER_MS
    );
    return () => window.clearTimeout(t);
  }, [returning, reduceMotion, index]);

  // Shared reveal state: desktop uses CSS :hover; mobile long-press flips this.
  const [revealed, setRevealed] = useState(false);
  // Each card action opens a picker that is a popover on desktop, a bottom-sheet
  // drawer on mobile (ResponsivePopover). Controlled so a selection can close it.
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(() => setRevealed(true));

  // Slide (rather than teleport) to a new slot when an action has just re-laid out
  // the list, so the space for an incoming card is visibly MADE before it arrives.
  useReflowFlip(cardRef, note.id, !reduceMotion);

  // Tap-outside dismisses the revealed bar on mobile.
  useEffect(() => {
    if (!revealed) return;
    const onDown = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setRevealed(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [revealed]);

  const handleCardClick = () => {
    // Swallow the click that follows a long-press so it doesn't open the note.
    if (longPress.firedRef.current) {
      longPress.firedRef.current = false;
      return;
    }
    // While selecting, a card tap toggles its selection instead of opening it.
    if (canSelect && selection.selectionMode) {
      selection.toggle(note.id);
      return;
    }
    openFromCard();
  };

  // Hand the card's on-screen rect to the sheet so the desktop modal can expand from
  // this card (Keep-style).
  const openFromCard = () => {
    const r = cardRef.current?.getBoundingClientRect();
    openNote(note.id, r ? { x: r.x, y: r.y, w: r.width, h: r.height } : undefined);
  };

  const del = () => {
    if (exiting) return; // a second click mid-exit must not restart the peel
    playExit("delete", quiet.del(note.id), () =>
      toast("Note moved to Trash", {
        icon: <Trash2 className="h-4 w-4" />,
        action: { label: "Undo", onClick: () => actions.restore.mutate(note.id) },
        reverse: { ids: [note.id], kind: "delete" },
      })
    );
  };
  const archive = () => {
    if (exiting) return;
    playExit("archive", quiet.archive(note.id), () =>
      toast("Note archived", {
        icon: <Archive className="h-4 w-4" />,
        action: { label: "Undo", onClick: () => actions.unarchive.mutate(note.id) },
        reverse: { ids: [note.id], kind: "archive" },
      })
    );
  };
  // Shared "watch it land" step for the two actions that move a card to a DIFFERENT
  // container (duplicate → the regular list, pin → the Pinned section). Both
  // containers re-render from their own query, so the card is unmounted here and
  // remounted there; the travel is drawn by a clone in the fixed overlay while that
  // happens. Called after the cache has been invalidated.
  const settleInto = (
    targetId: string,
    from: FlyRect | null,
    html: string,
    kind: "lift" | "stack",
    // Set when the SOURCE card survives the action (duplicate keeps its original).
    // The insertion re-lays out the list, so the rect captured on click is stale by
    // the time the clone launches — the flight would start from empty space, or from
    // on top of whichever card had since moved into that slot.
    sourceId?: string,
    // Set when a clone was already picked up at click time (pin). Then there is no
    // waiting to do: it is holding the card's place right now and just needs its
    // destination. Only duplicate, whose original never leaves the screen, can
    // afford to let the list rearrange first and launch afterwards.
    heldFlightId?: number | null,
  ) => {
    // Claim the destination BEFORE anything can render it. Its card still mounts on
    // the next refetch — the neighbours must reflow and open the gap — but it stays
    // invisible until the clone gets there, so the travel is never a second copy of
    // a card the user can already see. Only claimed when a clone will actually be
    // drawn; with no source rect (or under reduced motion) there is nothing to wait
    // for and hiding the card would just make it vanish.
    const willFly = !!from && !reduceMotion;
    if (willFly) markLanding(targetId);

    // The destination card only exists once its container's query has refetched, so
    // POLL for it rather than guessing a delay — a fixed timeout races the network
    // and silently drops the travel animation when the refetch is a little slow.
    const deadline = performance.now() + 800;
    const attempt = () => {
      // While a clone is in the air the destination is the card holding the landing,
      // NOT merely the first card with this id — during pin/unpin the source is still
      // on screen and shares the id.
      const destEl = willFly ? findLandingEl(targetId) : findCardEl(targetId);
      if (!destEl) {
        if (performance.now() < deadline) requestAnimationFrame(attempt);
        else {
          revealLanding(targetId); // never strand an invisible card
          if (heldFlightId != null) landFly(heldFlightId, null); // nor a held clone
        }
        return;
      }
      // A held clone is covering the card's place RIGHT NOW, so the destination has
      // to be measured immediately and its geometry has to be final — a smooth
      // scroll would keep the target drifting under a clone already on its way.
      // Duplicate has nothing in the air yet and can afford to scroll gently.
      destEl.scrollIntoView({
        behavior: reduceMotion || heldFlightId != null ? "auto" : "smooth",
        block: "nearest",
      });
      // The pulse is a colour change, not motion, so it runs in BOTH modes — under
      // reduced motion it is the only cue that the card moved. It fires once the card
      // has SETTLED (after the clone lands), which also clears the mount race: the
      // arriving card's highlight listener is registered by then.
      if (!willFly) {
        window.setTimeout(() => highlightNote(targetId), 60);
        return;
      }
      if (heldFlightId != null) {
        // Phase two: hand the waiting clone its destination. No delay — it has been
        // standing in for the card since the click and must keep doing so until it
        // arrives, or the note is missing from the screen in between.
        landFly(heldFlightId, rectOf(destEl));
        window.setTimeout(() => revealLanding(targetId), flyRevealMs(kind));
        window.setTimeout(() => highlightNote(targetId), flyHighlightMs(kind));
        return;
      }
      // Launch only once the list has finished opening the slot: the reflow is its
      // own beat (cards slide over to make room), and the travel reads as a non
      // sequitur if it starts while everything is still moving. Measuring here also
      // means the clone lands on the real card — the hidden card still has full
      // geometry, which is why it is `visibility: hidden` and not unmounted.
      window.setTimeout(() => {
        const el = findCardEl(targetId);
        if (!el) { revealLanding(targetId); return; }
        const srcEl = sourceId ? findCardEl(sourceId) : null;
        flyCard({ html, from: srcEl ? rectOf(srcEl) : from!, to: rectOf(el), kind });
        // Hand over while the clone is dissolving rather than after it has gone: the
        // clone holds full opacity until ~86% of its flight, so revealing the real
        // card there is a crossfade, not a blink with a one-frame gap.
        window.setTimeout(() => revealLanding(targetId), flyRevealMs(kind));
        window.setTimeout(() => highlightNote(targetId), flyHighlightMs(kind));
      }, REFLOW_MS + 60);
    };
    requestAnimationFrame(attempt);
  };

  // Duplicate: "stack and slide" (micro-interactions-duplicate-prd.md). The copy is
  // NOT opened any more — the user stays in the list and sees where it landed. A
  // clone of this card is drawn overlapping the original like a copy on a stack,
  // then travels to wherever the new card actually rendered, which finally pulses.
  const dupe = () => {
    const sourceEl = cardRef.current;
    const from = sourceEl ? rectOf(sourceEl) : null;
    const html = sourceEl?.innerHTML ?? "";
    // The grid is snapshotted for us by the mutation's own cache reconcile (see
    // useInvalidateNotes), so every card slides to its new slot rather than jumping.
    duplicate.mutate(note.id, {
      onSuccess: (copy) => settleInto(copy.id, from, html, "stack", note.id),
    });
  };

  // Cards don't carry note content (it's omitted from list serialization), so
  // export fetches the full note on demand — reusing / warming the same react-query
  // cache the detail view uses — then hands it to the chosen client-side exporter.
  const qc = useQueryClient();
  // A card carries no document (see lib/types.ts), so exporting from one fetches the
  // note first. `fn` may be async — Markdown export pulls the note's images in — and
  // is awaited so a failure anywhere in the chain lands on the same toast.
  const runExport = async (fn: (n: Note) => void | Promise<void>) => {
    try {
      const full = await qc.fetchQuery({ queryKey: ["note", note.id], queryFn: () => api.get<Note>(`/notes/${note.id}`) });
      await fn(full);
    } catch {
      toast("Could not export note", { kind: "error" });
    }
  };

  const applyTags = (next: string[]) => {
    const cur = note.tags.map((t) => t.id);
    next.filter((id) => !cur.includes(id)).forEach((tagId) => tagActions.apply.mutate({ noteId: note.id, tagId }));
    cur.filter((id) => !next.includes(id)).forEach((tagId) => tagActions.remove.mutate({ noteId: note.id, tagId }));
  };

  // Delete "peel" vs archive "recede" — the two removals are deliberately different
  // shapes: delete rotates and fades (destroyed), archive scales down, desaturates
  // and flattens its shadow toward the canvas, fading only in the last moment
  // (filed away, still exists). Reduced motion collapses both to a plain fade.
  const exitAnimate = !exiting
    ? undefined
    : reduceMotion
      ? { opacity: 0 }
      : exiting.kind === "archive"
        ? { scale: 0.95, filter: "saturate(0.9)", opacity: 0 }
        : { rotate: 3, y: 12, opacity: 0 };

  const sec = (ms: number) => ms / 1000;
  const exitTransition = !exiting
    ? // Not exiting: this transition governs the hover lift and the tap press, which
      // are the card ANSWERING a pointer rather than travelling anywhere. A spring,
      // because a press has weight — and because a lift that is interrupted (the
      // pointer leaving mid-rise) retargets from wherever it got to, instead of
      // restarting a fixed 150ms tween. Pace lives in SPRING_ANSWER's visualDuration.
      SPRING_ANSWER
    : reduceMotion
      ? { duration: sec(REDUCED_FADE_MS) }
      : exiting.kind === "archive"
        ? {
            scale: { duration: sec(ARCHIVE_RECEDE_MS), ease: EASE_FOLLOW },
            filter: { duration: sec(ARCHIVE_RECEDE_MS), ease: EASE_FOLLOW },
            // Opacity is NOT the signal here: it only drops in the final window.
            opacity: { duration: sec(ARCHIVE_FADE_MS), delay: sec(ARCHIVE_TOTAL_MS - ARCHIVE_FADE_MS) },
          }
        : {
            duration: sec(DELETE_PEEL_MS),
            ease: EASE_END,
            // Single: the peel waits out the strikethrough draw + its hold, then
            // throws the card. Bulk: there is no strikethrough to wait for, so the
            // cards peel straight away — offset a little from each other (capped, or
            // the tail of a long selection would still be leaving well after the
            // toast) so the batch reads as a batch rather than one thick card.
            delay: exiting.bulk
              ? sec(Math.min(index, DELETE_BULK_STAGGER_CAP) * DELETE_BULK_STAGGER_MS)
              : sec(DELETE_STRIKE_MS + DELETE_HOLD_MS),
          };

  // Reveal rule for the action bar: hidden at rest (space still reserved so
  // revealing causes no layout shift), shown on desktop hover or mobile long-press.
  // Lock/unlock passphrase dialog for this card. `lockEverOpened` keeps the dialog
  // out of the tree until it is first needed — a list holds dozens of cards — while
  // still leaving it MOUNTED afterwards, so closing it can play its exit.
  const [lockMode, setLockMode] = useState<LockMode>(null);
  const [lockEverOpened, setLockEverOpened] = useState(false);
  const openLock = (mode: Exclude<LockMode, null>) => { setLockEverOpened(true); setLockMode(mode); };
  const lockFx = useLockFx(note.id, note.isLocked);

  const barReveal = revealed
    ? "opacity-100 pointer-events-auto"
    : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto";

  return (
    <motion.div
      ref={cardRef}
      data-note-id={note.id}
      // Marks this card as the DESTINATION of a travel animation while it waits for
      // its clone — the only reliable way to tell it apart from the stale source
      // card, which briefly shares its note id (see findLandingEl).
      data-landing={landingHidden ? "" : undefined}
      whileHover={exiting ? undefined : { y: -2 }}
      whileTap={exiting ? undefined : { scale: 0.995 }}
      animate={exitAnimate}
      transition={exitTransition}
      className={cn(
        "raised-top group relative flex h-full cursor-pointer flex-col gap-2 rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-xl",
        // Selection is the only card outline; opening a note (active) shows no
        // border — the panel + dimmed backdrop already signal focus.
        selected && "border-ring ring-1 ring-ring",
        // Brief attention pulse once a duplicate has settled into the list.
        highlighted && "border-ring ring-2 ring-ring",
        // A card on its way out is inert — no hover, no clicks, no stray actions.
        exiting && "pointer-events-none",
        // Waiting for its clone: occupies its slot, but neither seen nor clickable.
        landingHidden && "invisible pointer-events-none",
        arriving && "card-arrive",
        // Undo rewinds the exit that removed this card (see the keyframes in index.css).
        returning === "delete" && "card-unpeel",
        returning === "archive" && "card-unrecede",
        // Archive settles toward the canvas: the shadow flattens via the card's own
        // `transition-shadow` (Framer can't interpolate the composite resting shadow,
        // so animating box-shadow inline would snap instead of ease).
        exiting?.kind === "archive" && "!shadow-none"
      )}
      onClick={handleCardClick}
      // Capped stagger so a BULK undo cascades back in the way it cascaded out,
      // instead of every restored card snapping back on the same frame. 0 for a
      // single undo (the restored note sorts to the front of the list).
      style={{
        ...(returning ? { ["--undo-delay" as string]: `${Math.min(index, UNDO_BULK_STAGGER_CAP) * UNDO_BULK_STAGGER_MS}ms` } : {}),
        ...(arriving ? { ["--card-arrive-ms" as string]: `${CARD_ARRIVE_MS}ms` } : {}),
      }}
      {...longPress.handlers}
    >
      {/* Colour code: a full-height left accent strip (theme-aware) instead of
          tinting the whole card. A rounded clip layer follows the card's rounded
          corners so the strip hugs the left edge; the selection ring is drawn
          outside the border box, so strip and ring never overlap. */}
      {strip.color && (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <span
            key={strip.key}
            className={cn(
              "absolute inset-y-0 left-0 w-1.5",
              strip.phase === "draw" && "accent-draw",
              strip.phase === "erase" && "accent-erase"
            )}
            style={{
              backgroundColor: strip.color,
              // Capped stagger so recolouring a big folder cascades instead of flashing.
              ["--accent-delay" as string]: strip.phase === "none" ? "0ms" : `${Math.min(index, 8) * 20}ms`,
              ["--accent-draw-ms" as string]: `${ACCENT_DRAW_MS}ms`,
              ["--accent-erase-ms" as string]: `${ACCENT_ERASE_MS}ms`,
            }}
            // Drop back to the resting phase the moment the stroke lands. The draw
            // class carries the tapered mask that softens the moving tip, and a tip
            // that has stopped moving is just a card whose colour code fades out at
            // the bottom for no reason — see the note on .accent-draw in index.css.
            // Only "draw" ends here: "erase" is handed to the next phase on a timer,
            // and clearing its class early would snap the retracted strip back to
            // full height for the last frame before that timer fires.
            onAnimationEnd={() => setStrip((s) => (s.phase === "draw" ? { ...s, phase: "none" } : s))}
          />
        </span>
      )}
      {/* Select checkbox (top-left): reveal-gated at rest; once anything on the
          page is selected it stays visible on every card until selection clears. */}
      {canSelect && (
        <Tooltip label={selected ? "Deselect note" : "Select note"} side="right">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? "Deselect note" : "Select note"}
          onClick={(e) => {
            e.stopPropagation();
            selection.toggle(note.id);
          }}
          className={cn(
            // Sits on the top-left corner (outside the content box) so revealing
            // it never shifts the title.
            "absolute -left-2 -top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-md border shadow-sm transition-colors",
            // The box is 20px because that is the right SIZE for a mark sitting on a
            // card corner — but 20px is half of what a thumb needs, and this is the
            // control that starts multi-select. The ::before is an invisible pad that
            // extends the hit area to 44px without touching the drawing or the
            // layout: it is absolutely positioned, so it adds nothing to the card's
            // height, which a virtualised list would notice. Growing the button
            // itself was the alternative and it would have put a 44px chip on the
            // corner of every card.
            "before:absolute before:-inset-3 before:content-[''] sm:before:hidden",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-transparent hover:border-primary",
            selection.selectionMode || selected ? "opacity-100 pointer-events-auto" : barReveal
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        </Tooltip>
      )}
      {/* Pin toggle (top-right): always visible when pinned, reveal-gated otherwise. */}
      {canPin && (
        <Tooltip label={pinned ? "Unpin from this page" : "Pin to this page"} side="left">
          <button
            type="button"
            aria-label={pinned ? "Unpin from this page" : "Pin to this page"}
            onClick={(e) => {
              e.stopPropagation();
              // Pin: "lift and place" — the card is picked up here and set down in the
              // other container (Pinned section ⇄ regular list). Snapshot it first,
              // because this card unmounts the moment the two queries refresh.
              //
              // The clone is launched NOW, before the request goes out, and simply
              // holds where the card already is. Both containers refetch on success
              // and this card unmounts, so a clone that waited for the destination
              // to exist left the note absent from the screen for the whole round
              // trip plus the reflow — it read as the note briefly vanishing rather
              // than moving. Held from the click, there is always something in its
              // place: the clone lifts, waits, then carries it over.
              const from = cardRef.current ? rectOf(cardRef.current) : null;
              const html = cardRef.current?.innerHTML ?? "";
              const heldFlightId =
                from && !reduceMotion ? flyCard({ html, from, to: null, kind: "lift" }) : null;
              const opts = {
                onSuccess: () => settleInto(note.id, from, html, "lift", undefined, heldFlightId),
              };
              if (pinned) pinActions.unpin.mutate({ noteId: note.id, scope: scope! }, opts);
              else pinActions.pin.mutate({ noteId: note.id, scope: scope! }, opts);
            }}
            className={cn(
              "card-action-btn absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              pinned ? "text-primary opacity-100" : cn("text-muted-foreground", barReveal)
            )}
          >
            <Pin className={cn("h-4 w-4", pinned && "fill-current")} />
          </button>
        </Tooltip>
      )}
      <div className={cn("flex items-center gap-2", canPin && "pr-7")}>
        {note.isLocked && (
          <Lock
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground",
              lockFx === "revealing" && "lock-reveal"
            )}
            style={{ ["--lock-reveal-ms" as string]: `${LOCK_REVEAL_MS}ms` }}
            aria-label="Locked"
          />
        )}
        <h3 className="type-card-title relative truncate">
          {note.title || "Untitled"}
          {/* Delete's first beat: a line drawn left-to-right across the title, so the
              action is visibly acknowledged before the card physically leaves. On undo
              the same line comes back struck through and retracts the way it was drawn,
              which is the beat that makes the rewind legible. */}
          {((exiting?.kind === "delete" && !exiting.bulk) || returning === "delete") && !reduceMotion && (
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 top-1/2 h-[2px] rounded-full bg-current",
                exiting?.kind === "delete" ? "strike-draw" : "strike-erase"
              )}
            />
          )}
        </h3>
      </div>
      {/* The card seals itself the same way the open note does: its preview blurs
          away and the padlock fades in where the text was (see useLockFx). */}
      {!note.isLocked && note.previewDoc != null && (
        <div
          className={cn(lockFx === "blurring" && "note-locking")}
          style={{ ["--lock-blur-ms" as string]: `${LOCK_BLUR_MS}ms` }}
        >
          <NotePreview doc={note.previewDoc} />
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2 text-xs text-muted-foreground">
        {note.folder && (
          /* The folder chip earns a folder glyph, because otherwise the ONLY thing
             separating it from a tag is that tags start with a "#" and it doesn't —
             a difference you have to already know to read. The icon says "this chip
             is a different kind of thing" without asking anyone to learn a
             convention, and it works for people who can't use the accent strip's
             colour to tell folders apart.

             Deliberately NOT tinted to the folder's accent colour, even though the
             card has already computed it for the strip. This row is meant to stay
             quiet: one coloured glyph in an otherwise monochrome line of metadata
             would pull the eye away from the note's own title, and it would only
             work on folders that actually have a colour. Plain inherits the chip's
             text tone, which is exactly how tags render their "#".

             `shrink-0` is not decoration: the row is `flex flex-wrap`, so a long
             folder name would otherwise squeeze the icon narrower rather than
             wrapping the chip. */
          <span className="chip-scrim flex items-center gap-1 rounded px-1.5 py-0.5 text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]">
            <Folder className="h-3 w-3 shrink-0" aria-hidden="true" />
            {note.folder.name}
          </span>
        )}
        {note.tags.map((t) => (
          <span key={t.id} className="chip-scrim rounded px-1.5 py-0.5 text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]">#{t.name}</span>
        ))}
        <span className="ml-auto whitespace-nowrap">{relativeTime(note.updatedAt)}</span>
      </div>

      {/* Bottom action bar — reserved height at rest (no layout shift), filter-aware.
          `.card-action-bar` lets touch devices force it visible at rest (see the
          coarse-pointer rule in index.css) since long-press is undiscoverable. */}
      <div
        className={cn("card-action-bar mt-1 flex min-h-8 items-center gap-0.5 border-t border-transparent pt-1 transition-opacity", barReveal)}
        onClick={(e) => e.stopPropagation()}
      >
        {filter === "active" && (
          <>
            <BarButton label="Archive" onClick={archive}>
              <Archive className="h-4 w-4" />
            </BarButton>
            <BarButton
              label={note.isLocked ? "Unlock to duplicate" : "Duplicate"}
              onClick={dupe}
              disabled={note.isLocked}
            >
              <Copy className="h-4 w-4" />
            </BarButton>
            <ResponsivePopover
              open={organizeOpen}
              onOpenChange={setOrganizeOpen}
              title="Organize"
              triggerLabel="Change folder & tags"
              align="end"
              contentClassName="w-72"
              trigger={
                <button
                  type="button"
                  aria-label="Change folder & tags"
                  className="card-action-btn inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Folder className="h-4 w-4" />
                </button>
              }
            >
              <div className="flex flex-col gap-3 p-1 max-sm:p-4">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Folder</div>
                  <FolderSelect
                    value={note.folder?.id ?? null}
                    onChange={(folderId) => updateNote.mutate({ id: note.id, folderId })}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Tags</div>
                  <TagMultiSelect value={note.tags.map((t) => t.id)} onChange={applyTags} />
                </div>
              </div>
            </ResponsivePopover>
            {note.isLocked ? (
              <BarButton label="Unlock to export" disabled>
                <Download className="h-4 w-4" />
              </BarButton>
            ) : (
              <ResponsivePopover
                open={exportOpen}
                onOpenChange={setExportOpen}
                title="Export"
                triggerLabel="Export this note"
                align="end"
                contentClassName="w-52 p-1"
                trigger={
                  <button
                    type="button"
                    aria-label="Export this note"
                    className="card-action-btn inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                }
              >
                <div className="p-1 max-sm:p-2">
                  <button
                    onClick={() => { runExport(exportNoteAsMarkdown); setExportOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover-scrim max-sm:py-3 max-sm:text-base"
                  >
                    <FileText className="h-4 w-4" /> Export as Markdown
                  </button>
                  <button
                    onClick={() => { runExport(exportNoteAsPdf); setExportOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover-scrim max-sm:py-3 max-sm:text-base"
                  >
                    <Printer className="h-4 w-4" /> Export as PDF
                  </button>
                </div>
              </ResponsivePopover>
            )}
            {/* Seal an open note; on a locked one, get back in to read it. Removing
                the lock outright is NOT offered here — changing a note's at-rest
                security state belongs in the note itself, where the consequences are
                spelled out, not one hover away in a list. */}
            <BarButton
              label={note.isLocked ? "View content" : "Lock note"}
              onClick={() => openLock(note.isLocked ? "unlock" : "lock")}
            >
              {note.isLocked ? <Eye className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </BarButton>
            <BarButton label="Delete" onClick={del} danger>
              <Trash2 className="h-4 w-4" />
            </BarButton>
          </>
        )}
        {filter === "archive" && (
          <BarButton label="Unarchive" onClick={() => actions.unarchive.mutate(note.id)}>
            <ArchiveRestore className="h-4 w-4" />
          </BarButton>
        )}
        {filter === "trash" && (
          <>
            <BarButton label="Restore" onClick={() => actions.restore.mutate(note.id)}>
              <RotateCcw className="h-4 w-4" />
            </BarButton>
            <BarButton label="Delete permanently" onClick={() => actions.permanent.mutate(note.id)} danger>
              <XCircle className="h-4 w-4" />
            </BarButton>
          </>
        )}

        {/* Passphrase dialog for the bar's lock action. Kept INSIDE the bar because a
            portal still bubbles its events up the REACT tree — anywhere else in the
            card and a click inside the dialog would fall through to the card's own
            onClick and open the note behind it.

            A successful "View content" opens the note: the decrypted doc is in the
            session keystore by then, so the note view picks it up on mount and shows
            the contents. Without this the passphrase would buy the reader nothing —
            a card has nowhere to display a document. */}
        {lockEverOpened && (
          <LockDialog
            note={note}
            mode={lockMode}
            onModeChange={setLockMode}
            onSessionUnlock={openFromCard}
          />
        )}
      </div>
    </motion.div>
  );
}
