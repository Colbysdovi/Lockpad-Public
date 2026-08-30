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
import { useNoteHighlight, useLandingHidden, useReflowFlip, useLockFx, flyCard, landFly, highlightNote, findCardEl, findLandingEl, rectOf, takeReturn, useBulkExit, markLanding, revealLanding, deferReflow, holdReflow, releaseReflow, type FlyRect, type UndoKind } from "@/lib/noteFx";
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
  REFLOW_TRAIL_MS,
  REFLOW_AFTER_LAUNCH_MS,
  SETTLE_IN_PLACE_PX,
  flyDistance,
  flyDurationMs,
  settleDelayMs,
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
import { useT, useFormat } from "@/lib/i18n";

// Recency on a card, in the reader's language.
//
// This used to build "3h ago" by concatenating an English suffix onto a number, and
// fell back to toLocaleDateString(undefined, …) — the browser's locale — past thirty
// days. Both are wrong once there is a second language: French puts the marker in
// front ("il y a 3 h"), and `undefined` asks the machine rather than the person.
//
// The thresholds are unchanged, so a card shows the same granularity it always did;
// only the phrasing now comes from the language.
function useRelativeTime(): (iso: string) => string {
  const format = useFormat();
  return (iso: string) => {
    const day = (Date.now() - new Date(iso).getTime()) / 86400000;
    return day < 30 ? format.relativeTime(iso) : format.shortDate(iso);
  };
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
  const t = useT();
  const relativeTime = useRelativeTime();
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
      toast(t("note.movedToTrash"), {
        icon: <Trash2 className="h-4 w-4" />,
        action: { label: t("common.undo"), onClick: () => actions.restore.mutate(note.id) },
        reverse: { ids: [note.id], kind: "delete" },
      })
    );
  };
  const archive = () => {
    if (exiting) return;
    playExit("archive", quiet.archive(note.id), () =>
      toast(t("note.archived"), {
        icon: <Archive className="h-4 w-4" />,
        action: { label: t("common.undo"), onClick: () => actions.unarchive.mutate(note.id) },
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
    kind: "lift" | "stack",
    // The clone that was picked up on the click and is waiting in the air right now.
    // Both travelling actions launch this way: the copy (or the card being pinned)
    // leaves its origin the moment it is asked to, and only needs telling where it
    // ended up. Null under reduced motion, where nothing flies at all.
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
    const POLL_MS = 16;
    const attempt = () => {
      // While a clone is in the air the destination is the card holding the landing,
      // NOT merely the first card with this id — during pin/unpin the source is still
      // on screen and shares the id.
      const destEl = willFly ? findLandingEl(targetId) : findCardEl(targetId);
      if (!destEl) {
        if (performance.now() < deadline) window.setTimeout(attempt, POLL_MS);
        else {
          revealLanding(targetId); // never strand an invisible card
          if (heldFlightId != null) landFly(heldFlightId, null); // nor a held clone
          releaseReflow(0); // nor a grid frozen waiting for a flight that gave up
        }
        return;
      }
      // A clone is covering the card's place RIGHT NOW, so the destination has to be
      // measured immediately and its geometry has to be final — a smooth scroll
      // would keep the target drifting under a clone already on its way.
      destEl.scrollIntoView({ behavior: "auto", block: "nearest" });
      // The pulse is a colour change, not motion, so it runs in BOTH modes — under
      // reduced motion it is the only cue that the card moved. It fires once the card
      // has SETTLED (after the clone lands), which also clears the mount race: the
      // arriving card's highlight listener is registered by then.
      if (!willFly) {
        releaseReflow(0);
        window.setTimeout(() => highlightNote(targetId), 60);
        return;
      }
      if (heldFlightId == null) { releaseReflow(0); revealLanding(targetId); return; }
      // Hand the waiting clone its destination, with no delay: it has been standing
      // in for the card since the click and must keep doing so until it arrives, or
      // the note is missing from the screen in between.
      //
      // The rect is read off the destination card itself, which is safe even though
      // the list is mid-reflow around it: a NEWLY inserted card was not in the
      // reflow snapshot, so it never FLIPs, so it is already sitting at its final
      // position while its neighbours are still sliding towards theirs. That is
      // exactly the geometry the clone needs — where the slot will be, not where the
      // list currently looks. (The card is `visibility: hidden` rather than
      // unmounted precisely so it still has geometry to read.)
      const to = rectOf(destEl);
      // Whoever has further to go moves first. A copy with a real journey ahead of it
      // sets off at once and the list opens as it comes; a copy already hovering over
      // its slot waits, lifted, while the original slides out from under it, and only
      // then comes down. settleDelayMs decides which of those this is.
      const distance = flyDistance(from!, to);
      const ms = flyDurationMs(kind, distance);
      // The list has been holding still, waiting for exactly this moment (see
      // holdReflow). Let it go now, timed against the journey rather than against the
      // network: the card sets off, and a beat later the grid starts clearing its
      // path, finishing as the card touches down.
      //
      // A settle IN PLACE is the one case that runs the other way round. There is no
      // journey to lead with, so the list has to move FIRST and the card comes down
      // into the space it just opened — which is what settleDelayMs below is waiting
      // for. Releasing immediately is what gives it something to wait for.
      releaseReflow(distance <= SETTLE_IN_PLACE_PX ? 0 : REFLOW_AFTER_LAUNCH_MS);
      window.setTimeout(() => {
        // Re-measure rather than trusting the rect from before the wait: the list has
        // been rearranging in the meantime, and a stale target would drop the card
        // slightly off its slot.
        const el = findLandingEl(targetId) ?? findCardEl(targetId);
        const at = el ? rectOf(el) : to;
        if (kind === "stack") {
          // Duplicate hands over rather than dissolving: the overlay reveals the real
          // card the moment this clone has genuinely arrived, then drops the clone a
          // frame later. Nothing here schedules the handover, because the settle runs
          // on a spring and there is no honest number to schedule it against.
          landFly(heldFlightId, at, { ms, reveal: targetId });
          return;
        }
        // Pin keeps the crossfade it has always had, on its own timers (PRD §3.6).
        // The clone holds full opacity until ~86% of its flight, so revealing the real
        // card there is a crossfade rather than a blink with a one-frame gap.
        landFly(heldFlightId, at, { ms });
        window.setTimeout(() => revealLanding(targetId), flyRevealMs(ms));
        window.setTimeout(() => highlightNote(targetId), flyHighlightMs(ms));
      }, settleDelayMs(distance));
    };
    // A TIMER, not requestAnimationFrame. rAF does not fire at all while the page is
    // hidden, and this poll is what reveals the destination card and lands the clone —
    // so duplicating a note and immediately switching tabs used to leave the card
    // permanently invisible and a clone stranded on the overlay, with nothing able to
    // recover either. Measured: still hidden and still stranded 2.2s after the click.
    // A timer is throttled in a background tab rather than stopped, so the sequence
    // always completes; while the page is visible 16ms is a frame anyway.
    window.setTimeout(attempt, POLL_MS);
  };

  // Duplicate: the copy leaves first, and the list gets out of its way afterwards.
  // The copy is NOT opened — the user stays in the list and watches where it landed.
  //
  // Order is the entire point of this one. The list used to open the gap first and
  // drop the copy in once it was ready, which reads as two unrelated events: a space
  // appears, then something arrives to fill it. Nothing behaves that way. So the
  // clone is picked up on the CLICK, before the request has even gone out — the copy
  // visibly leaves its original — and the reflow is told to trail it, so the
  // neighbours hold still until it is under way and then slide because it is coming.
  const dupe = () => {
    const sourceEl = cardRef.current;
    const from = sourceEl ? rectOf(sourceEl) : null;
    const html = sourceEl?.innerHTML ?? "";
    const heldFlightId = from && !reduceMotion ? flyCard({ html, from, to: null, kind: "stack" }) : null;
    // Set before the request, because the reflow is captured by the mutation's own
    // cache reconcile (useInvalidateNotes) the instant the server answers — which is
    // before anything here gets to run again.
    if (heldFlightId != null) deferReflow(REFLOW_TRAIL_MS);
    duplicate.mutate(note.id, {
      onSuccess: (copy) => settleInto(copy.id, from, "stack", heldFlightId),
      onError: () => {
        // Nothing was inserted, so nothing will reflow — hand the delay back rather
        // than leaving it primed for whichever unrelated action captures next. The
        // clone fades where it stands instead of flying to a slot that never existed.
        deferReflow(0);
        if (heldFlightId != null) landFly(heldFlightId, null);
      },
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
      toast(t("note.export.failed"), { kind: "error" });
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
        <Tooltip label={selected ? t("note.deselect") : t("note.select")} side="right">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? t("note.deselect") : t("note.select")}
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
        <Tooltip label={pinned ? t("note.unpin") : t("note.pin")} side="left">
          <button
            type="button"
            aria-label={pinned ? t("note.unpin") : t("note.pin")}
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
              // And the list is told to HOLD until that clone actually sets off.
              //
              // Order is the whole point here, and it used to be backwards. Both
              // containers refetch when the server answers, and the grid rearranged on
              // that render — while the card being pinned had nowhere to fly to yet,
              // because its destination is rendered by that very refetch. So the space
              // opened first and the card was posted into it afterwards, which is not
              // how anything moves. Held, the grid stays exactly as it was until the
              // card is under way, and then gets out of its way because it is coming.
              //
              // Set before the request, because the reflow is captured by the
              // mutation's own cache reconcile the instant the server answers, which
              // is before anything here runs again.
              if (heldFlightId != null) holdReflow();
              const opts = {
                onSuccess: () => settleInto(note.id, from, "lift", heldFlightId),
                onError: () => {
                  // Nothing moved between containers, so nothing will reflow — hand
                  // the hold back rather than leaving it primed for whichever
                  // unrelated action captures next, and put the clone down.
                  holdReflow(false);
                  if (heldFlightId != null) landFly(heldFlightId, null);
                },
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
            aria-label={t("note.locked")}
          />
        )}
        <h3 className="type-card-title relative truncate">
          {note.title || t("note.untitled")}
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
            <BarButton label={t("note.archive")} onClick={archive}>
              <Archive className="h-4 w-4" />
            </BarButton>
            <BarButton
              label={note.isLocked ? t("note.duplicate.locked") : t("note.duplicate")}
              onClick={dupe}
              disabled={note.isLocked}
            >
              <Copy className="h-4 w-4" />
            </BarButton>
            <ResponsivePopover
              open={organizeOpen}
              onOpenChange={setOrganizeOpen}
              title={t("note.organize")}
              triggerLabel={t("note.organize.trigger")}
              align="end"
              contentClassName="w-72"
              trigger={
                <button
                  type="button"
                  aria-label={t("note.organize.trigger")}
                  className="card-action-btn inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Folder className="h-4 w-4" />
                </button>
              }
            >
              <div className="flex flex-col gap-3 p-1 max-sm:p-4">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("note.folder")}</div>
                  <FolderSelect
                    value={note.folder?.id ?? null}
                    onChange={(folderId) => updateNote.mutate({ id: note.id, folderId })}
                    className="w-full"
                  />
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t("note.tags")}</div>
                  <TagMultiSelect value={note.tags.map((t) => t.id)} onChange={applyTags} />
                </div>
              </div>
            </ResponsivePopover>
            {note.isLocked ? (
              <BarButton label={t("note.export.locked")} disabled>
                <Download className="h-4 w-4" />
              </BarButton>
            ) : (
              <ResponsivePopover
                open={exportOpen}
                onOpenChange={setExportOpen}
                title={t("note.export")}
                triggerLabel={t("note.export.trigger")}
                align="end"
                contentClassName="w-52 p-1"
                trigger={
                  <button
                    type="button"
                    aria-label={t("note.export.trigger")}
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
                    <FileText className="h-4 w-4" /> {t("note.export.markdown")}
                  </button>
                  <button
                    onClick={() => { runExport(exportNoteAsPdf); setExportOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover-scrim max-sm:py-3 max-sm:text-base"
                  >
                    <Printer className="h-4 w-4" /> {t("note.export.pdf")}
                  </button>
                </div>
              </ResponsivePopover>
            )}
            {/* Seal an open note; on a locked one, get back in to read it. Removing
                the lock outright is NOT offered here — changing a note's at-rest
                security state belongs in the note itself, where the consequences are
                spelled out, not one hover away in a list. */}
            <BarButton
              label={note.isLocked ? t("note.viewContent") : t("note.lock")}
              onClick={() => openLock(note.isLocked ? "unlock" : "lock")}
            >
              {note.isLocked ? <Eye className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </BarButton>
            <BarButton label={t("common.delete")} onClick={del} danger>
              <Trash2 className="h-4 w-4" />
            </BarButton>
          </>
        )}
        {filter === "archive" && (
          <BarButton label={t("note.unarchive")} onClick={() => actions.unarchive.mutate(note.id)}>
            <ArchiveRestore className="h-4 w-4" />
          </BarButton>
        )}
        {filter === "trash" && (
          <>
            <BarButton label={t("note.restore")} onClick={() => actions.restore.mutate(note.id)}>
              <RotateCcw className="h-4 w-4" />
            </BarButton>
            <BarButton label={t("note.deletePermanently")} onClick={() => actions.permanent.mutate(note.id)} danger>
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
