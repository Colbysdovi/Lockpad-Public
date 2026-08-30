import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE_FOLLOW, SPRING_ANSWER, REFLOW_MS, REFLOW_HOLD_BAIL_MS, EASE_REFLOW, FLY_MS, FLY_HOLD_MAX_MS, FLY_CLEANUP_MAX_MS, flyCleanupMs, FLY_LIFT, FLY_NO_SHADOW, SPRING_SETTLE, SETTLE_IN_PLACE_PX, flyDistance, HIGHLIGHT_AFTER_REVEAL_MS, FLY_SETTLE_TAIL_MS, LOCK_REVEAL_MS, LOCK_BAIL_MS } from "./motion";

// Cross-component effects for the note micro-interactions.
//
// Some animations can't live inside the card that triggers them: a pinned card
// travels from the virtualized list into the (separate, non-virtualized) Pinned
// section, and a duplicate has to be pointed at from its source card to wherever the
// copy lands. Both containers unmount/remount their own cards freely, so the travel
// is drawn by a short-lived CLONE in a fixed overlay above everything — the real
// cards just appear/disappear underneath it.
//
// A module-level emitter (rather than context) keeps this usable from anywhere
// without threading providers through the virtualizer.

export interface FlyRect { x: number; y: number; width: number; height: number }

interface FlyRequest {
  html: string; // innerHTML snapshot of the source card
  from: FlyRect;
  // Null means the destination is not known YET: the clone picks the card up and
  // holds it there until landFly supplies one. Pin needs this — the destination only
  // exists after the round trip, but the source card is unmounted by that same
  // refetch, so a clone that waited for the target left the note missing from the
  // screen for the whole request. Launching in place at click time means something
  // is always covering the card's spot.
  to: FlyRect | null;
  /** "lift" = pin's pick-up-and-place arc; "stack" = duplicate's copy. */
  kind: "lift" | "stack";
  /** The note whose real card this clone is standing in for. When set, the clone does
   *  NOT dissolve: the real card is revealed underneath it the moment it has actually
   *  arrived, and the clone is dropped a frame later. See the ordered-swap note on
   *  NoteFxLayer for why that is not the same thing as a very fast crossfade. */
  reveal?: string;
  /** How long the trip to `to` should take. Supplied by whoever lands the flight,
   *  because only they know how far it actually has to go — a copy settling into the
   *  slot it is already hovering over needs a short descent, not a cross-screen
   *  travel played out over zero pixels. */
  ms?: number;
}

type FlyListener = (req: FlyRequest & { id: number }) => void;
type LandListener = (payload: { id: number; to: FlyRect | null; ms?: number; reveal?: string }) => void;
type HighlightListener = (noteId: string) => void;

const flyListeners = new Set<FlyListener>();
const landListeners = new Set<LandListener>();
const highlightListeners = new Set<HighlightListener>();
let flySeq = 0;

/** Draw a card travelling from one on-screen rect to another. With `to: null` it is
 *  picked up and held in place until landFly. Returns the flight id. */
export function flyCard(req: FlyRequest): number {
  const payload = { ...req, id: ++flySeq };
  flyListeners.forEach((l) => l(payload));
  return payload.id;
}

/** Give a held flight its destination — or `null` to call it off (the clone just
 *  fades where it is, so a failed request never strands a card on screen). */
export function landFly(id: number, to: FlyRect | null, opts?: { ms?: number; reveal?: string }) {
  landListeners.forEach((l) => l({ id, to, ms: opts?.ms, reveal: opts?.reveal }));
}

/** Briefly ring-highlight a card wherever it currently lives. */
export function highlightNote(noteId: string) {
  highlightListeners.forEach((l) => l(noteId));
}

// Notes that are being composed right now (created, still blank) and are therefore
// held out of the list. Kept at MODULE level, not in a ref: opening the note sheet
// remounts the page, which would wipe a component-local registry and lose the
// arrival animation exactly when it is due.
const pendingArrivals = new Map<string, number>();

/** Remember that this note is being composed, so its eventual card animates in.
 *  Called at CREATION, before the sheet opens: the create mutation refreshes the
 *  list first, so without this there is a window where the still-empty card would
 *  flash into the list before anything knows it is being composed. */
export function markComposing(noteId: string) {
  pendingArrivals.set(noteId, Date.now());
}

/** True if this note is owed an arrival animation (does not consume it). */
export function hasArrival(noteId: string): boolean {
  return pendingArrivals.has(noteId);
}

/** True for the brief window right after creation, before the sheet reports open. */
export function isJustCreated(noteId: string, withinMs = 2000): boolean {
  const at = pendingArrivals.get(noteId);
  return at !== undefined && Date.now() - at < withinMs;
}

/** Consume the arrival so it plays exactly once. */
export function consumeArrival(noteId: string) {
  pendingArrivals.delete(noteId);
}

// ---------------------------------------------------------------------------
// Reflow beat
//
// Inserting or removing a card re-lays out every card after it, and the virtualizer
// applies that new layout in a single frame — the whole grid teleports. That made
// the travel animations unreadable: by the time a clone launched, every card
// (including the one it was launching FROM) had already jumped somewhere else, so
// the flight started from a position where nothing was any more.
//
// So the reflow gets its own beat. The action snapshots where every card is BEFORE
// mutating; each card then FLIPs from its old position to its new one, and the
// travel only launches once that has settled. Snapshot-driven rather than a standing
// layout watcher: outside the short window after an action this costs one map lookup
// per render and changes nothing.
const reflowFrom = new Map<string, { x: number; y: number }>();
let reflowUntil = 0;
// How long the current reflow waits before it starts sliding. Zero for every action
// that simply rearranges the list; non-zero when a card is flying into the slot the
// reflow is opening, so the neighbours move out of the way of something already on
// its way rather than politely clearing a space in advance. See deferReflow.
let reflowDelay = 0;
let nextReflowDelay = 0;

/** Make the NEXT reflow trail whatever is travelling into it: the cards hold their
 *  old positions for `ms`, then slide. One-shot, consumed by the next captureReflow —
 *  the delay belongs to a single action, and the action that sets it is the one that
 *  knows a clone is about to launch. A caller that forgets to set it gets the plain
 *  immediate reflow, which is the right default for everything else. */
export function deferReflow(ms: number) {
  nextReflowDelay = ms;
}

// ── Holding the reflow for a flight that has not launched yet ────────────────
//
// deferReflow above is a fixed head start, counted from the cache reconcile. That is
// the right shape for duplicate, where the copy is already in the air by then. It is
// the wrong shape for pin: the card is moving to the OTHER container, so its
// destination does not exist until two queries have refetched and rendered it, and
// the clone cannot set off until it does. Any fixed number would be guessing at a
// network round trip, and guessing low is what produced the bug this replaces — the
// list finished opening the gap while the card was still barely under way.
//
// So the reflow is held instead of delayed. Each card's slide is created PAUSED, at
// its first keyframe, which renders it exactly where it already was; the whole grid
// therefore sits still, looking untouched, for as long as the hold lasts. The flight
// releases them when it launches, and from that moment the timing is honest, because
// it is measured against the thing the user is actually watching.
interface ReflowHold {
  /** Every paused slide collected so far. Pin refetches two queries, so the cards
   *  arrive in two waves a frame or two apart, and both belong to the same hold. */
  anims: Animation[];
  /** Set once a release has been scheduled, so the bail cannot double-book it. */
  scheduled: boolean;
  /** Set when the hold has been let go. Later slides run normally. */
  closed: boolean;
}
let hold: ReflowHold | null = null;
let nextReflowHeld = false;

/** Hold the NEXT reflow until a flight releases it. One-shot, consumed by the next
 *  captureReflow, exactly like deferReflow — and cancelled the same way, by passing
 *  `false`, so an action that fails before it reflows hands the hold back instead of
 *  leaving it primed for whichever unrelated action captures next. */
export function holdReflow(on = true) {
  nextReflowHeld = on;
}

/** Let the held cards slide, `delayMs` from now. Called by the flight at the moment
 *  it launches, so the delay is a position within the journey rather than an offset
 *  from a network event. Safe to call when nothing is held (duplicate, every ordinary
 *  action) and safe to call twice — the first call wins, which is what lets the bail
 *  below be unconditional. */
export function releaseReflow(delayMs: number) {
  const h = hold;
  if (!h || h.scheduled) return;
  h.scheduled = true;
  window.setTimeout(() => {
    h.closed = true;
    h.anims.forEach((a) => a.play());
    if (hold === h) hold = null;
  }, Math.max(0, delayMs));
}

/** Pause a freshly created slide and add it to the current hold. Returns whether it
 *  was taken, so the caller knows not to treat it as running. */
function collectHeld(anim: Animation): boolean {
  if (!hold || hold.closed) return false;
  anim.pause();
  hold.anims.push(anim);
  return true;
}

/** Snapshot every rendered card's position. Call BEFORE the mutation that re-lays
 *  out the list; cards then animate from here to wherever they end up. */
export function captureReflow() {
  reflowFrom.clear();
  document.querySelectorAll<HTMLElement>("[data-note-id]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (el.dataset.noteId) reflowFrom.set(el.dataset.noteId, { x: r.x, y: r.y });
  });
  reflowDelay = nextReflowDelay;
  nextReflowDelay = 0;
  if (nextReflowHeld) {
    hold = { anims: [], scheduled: false, closed: false };
    nextReflowHeld = false;
    // Never leave the grid frozen mid-rearrangement because a flight that was going
    // to release it never launched.
    window.setTimeout(() => releaseReflow(0), REFLOW_HOLD_BAIL_MS);
  } else {
    hold = null;
  }
  // Only re-layouts caused by THIS action should animate — a later scroll or edit
  // must not inherit a stale snapshot. A delayed reflow is owed its full window on
  // top of the wait, or a slow refetch would land after the snapshot had expired and
  // the cards would teleport instead. A HELD reflow is owed the whole hold for the
  // same reason: its cards mount while the request is still in flight.
  reflowUntil = performance.now() + 600 + reflowDelay + (hold ? REFLOW_HOLD_BAIL_MS : 0);
}

/** Where this card was before the current reflow. PEEKS — it deliberately does not
 *  consume, because the effect below runs after every render and only one of those
 *  renders is the one where the card actually moves. */
function peekReflowFrom(noteId: string): { x: number; y: number } | null {
  if (performance.now() > reflowUntil) return null;
  return reflowFrom.get(noteId) ?? null;
}

/** Slide this card from where it used to be to where it now is, whenever an action
 *  has just re-laid out the list. Runs in a layout effect (after the DOM is updated,
 *  before paint) so the card is never seen at its new position first.
 *
 *  Driven through the Web Animations API rather than a style/class: the card's
 *  transform is owned by Framer (hover lift, exit), and a WAAPI animation composites
 *  over inline styles for its duration instead of fighting them for ownership. */
export function useReflowFlip(ref: React.RefObject<HTMLElement | null>, noteId: string, enabled: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const prev = peekReflowFrom(noteId);
    if (!prev) return;
    const now = el.getBoundingClientRect();
    const dx = prev.x - now.x;
    const dy = prev.y - now.y;
    // Didn't actually move — and crucially, the snapshot is LEFT IN PLACE.
    //
    // This effect has no dependency array, so it runs after every render, and the
    // render where the data changes is not the first one to arrive: invalidating the
    // query flips it to `isFetching` first, which re-renders the whole list with the
    // OLD data still in it. On that render nothing has moved yet. Consuming the
    // snapshot there — which is what this used to do, because the old helper deleted
    // it before this check — threw away every card's starting position a frame before
    // it was needed, and the real re-layout then had nothing to animate from. The
    // cards cut straight to their new slots.
    //
    // For duplicate that is the entire illusion gone: the original is supposed to
    // slide out from under the raised copy, and instead it was teleporting to its new
    // column the instant the data landed, which reads as the original vanishing.
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    // A card a clone is flying to must SIT at its destination, not slide to it.
    //
    // Pin is the case that needs this and duplicate is the case that hid it. A
    // duplicate's copy is a brand new note, so it was never in the snapshot and never
    // had a slide to skip. A PINNED note is not new — it was already on screen in the
    // other container, under the same id — so it was in the snapshot, and the card
    // holding its landing slot was quietly FLIPping from its old position to its new
    // one behind `visibility: hidden`, in parallel with the clone doing exactly the
    // same journey in the overlay. Invisible, and therefore harmless to look at, but
    // not harmless: settleInto reads the flight's target rect off this very element,
    // and a rect read through a slide transform is where the card USED to be. The
    // clone was being aimed at the place it had just left. Measured mid-hold: the
    // destination reported the source's own position, which would collapse the
    // journey to zero and turn a flight across the grid into a settle in place.
    //
    // The snapshot is CONSUMED rather than left behind, or the card would slide after
    // all the moment it is revealed — from a position it left a second ago.
    if (isLanding(noteId)) { reflowFrom.delete(noteId); return; }
    reflowFrom.delete(noteId); // consumed only now that it is genuinely being used
    // `fill: backwards` is what makes the delay a HOLD rather than a pause with the
    // card already sitting at its destination: during the wait the element renders
    // the first keyframe, so it stays visually where it was until its turn comes.
    const slide = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: REFLOW_MS, easing: EASE_REFLOW, delay: reflowDelay, fill: reflowDelay ? "backwards" : "none" }
    );
    // Paused at its first keyframe, a slide renders the card at the position it is
    // travelling FROM — so a held grid looks like a grid that has not moved, rather
    // than one that has jumped and is waiting. Nothing else is needed to make the
    // hold invisible.
    collectHeld(slide);
  });
}

// ---------------------------------------------------------------------------
// Landing cards
//
// A travel animation (pin's lift, duplicate's stack) draws a CLONE flying to where
// the real card will be. The real card, however, is rendered by its container's own
// refetch, which lands long before the clone does — so the destination was already
// sitting there, fully painted, while a second copy of it flew across the screen.
// Two identical cards on screen at once is exactly the thing the animation is
// supposed to explain, and it made the flight read as decorative.
//
// The destination card still MOUNTS immediately — the surrounding cards have to
// reflow and open the gap the clone is aiming at — but it is held invisible (and
// inert) until the clone gets there. `visibility: hidden` rather than unmounting,
// precisely because the space has to be reserved and measurable: the flight's target
// rect is read off this very element.
const landing = new Set<string>();
const landingListeners = new Set<(noteId: string) => void>();

/** Hold this note's card invisible from the moment it mounts; a clone is en route. */
export function markLanding(noteId: string) {
  landing.add(noteId);
}

/** True while a card should stay invisible waiting for its clone. */
export function isLanding(noteId: string): boolean {
  return landing.has(noteId);
}

/** The clone has arrived (or given up) — show the real card. Idempotent. */
export function revealLanding(noteId: string) {
  if (!landing.delete(noteId)) return;
  landingListeners.forEach((l) => l(noteId));
}

/** Never leave a card invisible because a flight was dropped (destination never
 *  rendered, tab backgrounded mid-animation, layer unmounted). */
const LANDING_BAIL_MS = 1500;

/** True while this card is only holding its place for a clone that hasn't landed. */
export function useLandingHidden(noteId: string): boolean {
  const [hidden, setHidden] = useState(() => isLanding(noteId));
  useEffect(() => {
    if (!hidden) return;
    // The reveal can fire between the initializer and this effect (the flight is
    // short and the refetch that mounts us may resolve late), so re-check the
    // registry here rather than trusting the listener alone.
    if (!isLanding(noteId)) {
      setHidden(false);
      return;
    }
    const listener = (id: string) => { if (id === noteId) setHidden(false); };
    landingListeners.add(listener);
    const bail = window.setTimeout(() => revealLanding(noteId), LANDING_BAIL_MS);
    return () => { landingListeners.delete(listener); window.clearTimeout(bail); };
  }, [hidden, noteId]);
  return hidden;
}

// ---------------------------------------------------------------------------
// Locking a note
//
// Locking replaces a note's contents with a padlock and a sentence. Done as a plain
// cache refresh that is a hard cut — the paragraph you were reading is simply not
// there on the next frame, which reads as a glitch rather than as "this is secret
// now". So the note performs the change instead: the contents blur into
// disappearance and the locked state fades in behind them.
//
// The refresh is what redacts the note, so it has to be DEFERRED past the blur —
// invalidating immediately would swap in the locked placeholder while there was
// still something to blur, and the animation would have nothing to animate. Same
// policy as the delete/archive exits (see useQuietNoteActions).
const lockFxListeners = new Set<(noteId: string) => void>();

/** Start the lock animation for this note. Call right after the lock succeeds and
 *  BEFORE the cache refresh that redacts it. */
export function beginLockFx(noteId: string) {
  lockFxListeners.forEach((l) => l(noteId));
}

export type LockFxPhase = "blurring" | "revealing" | null;

/** Phase of the lock animation for one note, driving two CSS classes: the contents
 *  wear `note-locking` while blurring, the locked state wears `lock-reveal` as it
 *  fades in. Every surface showing the note animates — the open note view and its
 *  card in the list behind it — because they all read the same registry. */
export function useLockFx(noteId: string, locked: boolean): LockFxPhase {
  const [phase, setPhase] = useState<LockFxPhase>(null);

  useEffect(() => {
    const listener = (id: string) => { if (id === noteId) setPhase("blurring"); };
    lockFxListeners.add(listener);
    return () => { lockFxListeners.delete(listener); };
  }, [noteId]);

  // Hand off blur -> reveal when the refreshed note actually READS as locked, not on
  // a timer: the refresh is a network round-trip, and switching on schedule would
  // flash the old contents back for a frame whenever it ran long.
  useEffect(() => {
    if (phase !== "blurring") return;
    if (!locked) {
      // ...but never blur forever. If the refresh fails or the request is dropped,
      // drop the class so the (still unlocked) contents come back rather than
      // leaving the note faded to nothing.
      const bail = window.setTimeout(() => setPhase(null), LOCK_BAIL_MS);
      return () => window.clearTimeout(bail);
    }
    setPhase("revealing");
    const done = window.setTimeout(() => setPhase(null), LOCK_REVEAL_MS);
    return () => window.clearTimeout(done);
  }, [phase, locked]);

  return phase;
}

// ---------------------------------------------------------------------------
// Undo returns
//
// Notes whose removal has just been undone, and the exit they are owed the reverse
// of. Module-level for the same reason as `pendingArrivals`: the card that plays the
// reverse is not the card that played the exit — that one is long unmounted — and the
// list may remount entirely in between. A returning card claims its entry on MOUNT,
// which is exactly the frame the restore/unarchive refetch puts it back on screen.
//
// Entries are stamped so a card mounting much later (a scroll bringing a virtualized
// row back, a navigation) can't pick up a stale one and animate for no reason.
export type UndoKind = "delete" | "archive";
const pendingReturns = new Map<string, { kind: UndoKind; at: number }>();
const RETURN_WINDOW_MS = 8000;

/** Mark notes as coming back, so their cards rewind the exit they just played.
 *  Call this BEFORE the restore/unarchive request — the card can remount as soon as
 *  the response lands, and an entry claimed after that point is already too late. */
export function markReturning(noteIds: string[], kind: UndoKind) {
  const at = Date.now();
  for (const id of noteIds) pendingReturns.set(id, { kind, at });
}

// Answers already handed out this task, so a repeated claim for the same card gets
// the SAME answer instead of null. React's StrictMode double-invokes state
// initializers in development to surface impure ones, and a claim is impure by
// nature: without this the first invocation consumed the entry and the second — the
// one whose result React keeps — saw nothing, so the rewind silently never played.
// Cleared on the next macrotask; a genuine later remount (a virtualized row
// scrolling back in) therefore still gets null and stays static.
const claimed = new Map<string, UndoKind | null>();

/** Claim this note's owed reverse animation, if any. Plays once per undo. */
export function takeReturn(noteId: string): UndoKind | null {
  if (claimed.has(noteId)) return claimed.get(noteId)!;
  const entry = pendingReturns.get(noteId);
  if (!entry) return null;
  pendingReturns.delete(noteId);
  const kind = Date.now() - entry.at < RETURN_WINDOW_MS ? entry.kind : null;
  claimed.set(noteId, kind);
  window.setTimeout(() => claimed.delete(noteId), 0);
  return kind;
}

// ---------------------------------------------------------------------------
// Bulk exits
//
// A card animates its OWN removal (NoteCard.playExit) when the action came from that
// card's action bar. The bulk bar acts on a dozen cards at once and holds a
// reference to none of them, so the cards have to be told — which is the same
// problem the undo path above solves, from the other direction. Without this the
// bulk actions were the one place where notes simply blinked out of existence:
// the request landed, the cache reconciled, the rows unmounted. Undo animated
// correctly the whole time, which made the asymmetry look deliberate when it was
// just a missing message.
//
// A broadcast, not a claimed-on-mount registry: these cards are already on screen
// and must be interrupted where they stand, whereas an undone card does not exist
// yet at the moment it is marked.
const bulkExitListeners = new Set<(ids: Set<string>, kind: UndoKind) => void>();

/** Tell every listed card to play its removal animation now.
 *
 *  Call BEFORE the request and, crucially, before the cache reconcile: the reconcile
 *  is what unmounts the cards, so it has to wait for the animation exactly as the
 *  single-card path makes it wait (see useQuietNoteActions / useQuietBulkAction). */
export function beginBulkExit(noteIds: string[], kind: UndoKind) {
  const ids = new Set(noteIds);
  bulkExitListeners.forEach((l) => l(ids, kind));
}

/** The removal this card has been told to play, if any. */
export function useBulkExit(noteId: string): UndoKind | null {
  const [kind, setKind] = useState<UndoKind | null>(null);
  useEffect(() => {
    const listener = (ids: Set<string>, k: UndoKind) => {
      if (ids.has(noteId)) setKind(k);
    };
    bulkExitListeners.add(listener);
    return () => { bulkExitListeners.delete(listener); };
  }, [noteId]);
  return kind;
}

/** Snapshot an element's geometry in viewport coordinates (what the overlay uses). */
export function rectOf(el: Element): FlyRect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Find a rendered note card by id (cards carry data-note-id). */
export function findCardEl(noteId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(noteId)}"]`);
}

/** Find the card that is holding a landing slot for this note — the DESTINATION.
 *
 *  Pin and unpin move a note between two containers, and for a moment BOTH render a
 *  card with the same note id: the source is still there because its container's
 *  refetch has not landed yet. findCardEl returns whichever comes first in the DOM,
 *  which is the Pinned section — correct when pinning (the destination is up there)
 *  and exactly wrong when unpinning, where it returns the stale source and the clone
 *  flies to the place it already is. Only the destination carries data-landing (it
 *  claimed the landing on mount, which the already-mounted source never did), so
 *  that attribute is the unambiguous discriminator. */
export function findLandingEl(noteId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(noteId)}"][data-landing]`);
}

/** True while this note should show the post-arrival highlight pulse. */
export function useNoteHighlight(noteId: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const listener = (id: string) => {
      if (id !== noteId) return;
      setOn(true);
      window.setTimeout(() => setOn(false), 1200);
    };
    highlightListeners.add(listener);
    return () => { highlightListeners.delete(listener); };
  }, [noteId]);
  return on;
}

interface ActiveFly extends FlyRequest { id: number }

/**
 * Fixed overlay that draws in-flight card clones. Mounted once, app-wide.
 * Under reduced motion it renders nothing — the card simply appears at its
 * destination, and callers fall back to the highlight pulse to orient the user.
 */
export function NoteFxLayer(): ReactNode {
  const [flights, setFlights] = useState<ActiveFly[]>([]);
  const reduceMotion = useReducedMotion();
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;

  // Flights whose real card has already been handed the baton. Ids only ever grow, so
  // this is never cleared: re-arriving must be a no-op, or a late completion callback
  // would fire a second attention pulse on a card that settled long ago.
  const arrivedRef = useRef(new Set<number>());

  const drop = useCallback((id: number) => setFlights((f) => f.filter((x) => x.id !== id)), []);

  // ── The ordered swap ────────────────────────────────────────────────────────
  //
  // This is deliberately NOT a crossfade, and the difference is the whole point.
  //
  // The real card is opaque and — by this moment — pixel-identical to the clone
  // sitting on top of it. So there is nothing to fade BETWEEN: reveal the card
  // underneath, let it paint, then remove the clone. Neither step changes what is on
  // screen, because at every instant something opaque and identical is covering that
  // rectangle. A fade, by contrast, spends its whole duration with the clone at
  // partial opacity, which makes it its own stacking context compositing against
  // whatever is beneath — and that is the window in which any sub-pixel disagreement
  // between the fixed overlay and the virtualized grid becomes a visible double edge.
  // The fade was never hiding the seam; it was the only thing that could show it.
  //
  // Driven by the animation actually finishing rather than by a timer, because the
  // settle runs on a spring and a spring has no fixed end to schedule against. That
  // mismatch — a timer derived from one duration while the transform ran on another —
  // is what produced the blink this replaces: the card was revealed at its final
  // position while the clone was still 40% short of arriving, and the clone then went
  // transparent mid-move.
  const arrive = useCallback((id: number, reveal?: string) => {
    if (!reveal || arrivedRef.current.has(id)) return;
    arrivedRef.current.add(id);
    revealLanding(reveal);
    window.setTimeout(() => highlightNote(reveal), HIGHLIGHT_AFTER_REVEAL_MS);
    // Two frames, not one: the first lets React commit the card's visibility change,
    // the second lets the browser paint it. Only then is it safe to take the cover away.
    requestAnimationFrame(() => requestAnimationFrame(() => drop(id)));
  }, [drop]);

  useEffect(() => {
    const onFly = (req: ActiveFly) => {
      if (reduceRef.current) return;
      setFlights((f) => [...f, req]);
      // A flight with a destination cleans up on schedule. One still being held has
      // no schedule yet, so it gets a long backstop: if the landing never arrives
      // (the request failed, the destination never rendered) the clone must not sit
      // on the screen indefinitely.
      window.setTimeout(() => drop(req.id), req.to ? flyCleanupMs(req.ms ?? FLY_MS[req.kind]) : FLY_HOLD_MAX_MS);
    };
    const onLand = ({ id, to, ms, reveal }: { id: number; to: FlyRect | null; ms?: number; reveal?: string }) => {
      setFlights((f) => f.map((x) => (x.id === id ? { ...x, to, ms, reveal } : x)));
      // Backstop only. A reveal-driven flight normally hands over from its completion
      // callback; this catches the case where that never fires — a hidden tab pauses
      // the frame loop, and a card left permanently invisible is far worse than a
      // clone dropped a little late.
      const budget = to ? flyCleanupMs(ms ?? FLY_CLEANUP_MAX_MS) + (reveal ? FLY_SETTLE_TAIL_MS : 0) : 240;
      window.setTimeout(() => { arrive(id, reveal); drop(id); }, budget);
    };
    flyListeners.add(onFly);
    landListeners.add(onLand);
    return () => { flyListeners.delete(onFly); landListeners.delete(onLand); };
  }, [arrive, drop]);

  if (flights.length === 0) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70]">
      <AnimatePresence>
        {flights.map((f) => {
          // Per-action lift (see FLY_LIFT). `shadow: null` — pin — opts out of the
          // filter entirely rather than animating it to zero, so nothing about pin's
          // rendering changes at all.
          const lift = FLY_LIFT[f.kind];
          const shadowAtRest = lift.shadow ? { filter: FLY_NO_SHADOW } : {};
          // A settle-in-place has no journey to track, so it comes to rest on the
          // spring; anything with real distance to cover stays on FOLLOW, which is
          // the curve for something the eye is following across the screen.
          const settling = !!f.to && flyDistance(f.from, f.to) <= SETTLE_IN_PLACE_PX;
          const ms = f.ms ?? FLY_MS[f.kind];
          return (
          <motion.div
            key={f.id}
            // The clone is a static picture of the card — it never re-renders from
            // data, so it can't flicker while the real cards shuffle underneath.
            className={`raised-top absolute overflow-hidden rounded-2xl border bg-card p-5 ${lift.restShadow}`}
            initial={{
              x: f.from.x,
              y: f.from.y,
              width: f.from.width,
              height: f.from.height,
              scale: 1,
              rotate: 0,
              opacity: 1,
              ...shadowAtRest,
            }}
            // Two phases. HELD (no destination yet): the card is picked up off the
            // list — raised, nudged clear of the original and casting a deeper
            // shadow — and waits there while everything rearranges underneath it.
            // LANDING: it comes down onto the destination and dissolves as the real
            // card takes over.
            //
            // The lift used to be a bare 4% scale in place, on the reasoning that a
            // copy is distinguished by where it LANDS rather than by stacking on its
            // source. That held only while a copy landed far away. Now that it lands
            // in the slot beside its original there is no journey to read, so the
            // stack IS the explanation: two cards, one of them clearly picked up,
            // and the other sliding out from under it.
            //
            // Targets are plain values, not keyframe arrays, so the descent starts
            // from wherever the lift happens to be rather than snapping back to the
            // origin first.
            animate={
              f.to
                ? {
                    x: f.to.x,
                    y: f.to.y,
                    width: f.to.width,
                    height: f.to.height,
                    scale: 1,
                    rotate: 0,
                    // Stays fully opaque when a real card is taking over (the swap is
                    // ordered, not faded). Pin keeps its dissolve, unchanged.
                    opacity: f.reveal ? 1 : [1, 1, 0],
                    ...shadowAtRest,
                  }
                : {
                    x: f.from.x + lift.x,
                    y: f.from.y + lift.y,
                    width: f.from.width,
                    height: f.from.height,
                    scale: lift.scale,
                    rotate: lift.rotate,
                    opacity: 1,
                    ...(lift.shadow ? { filter: `drop-shadow(${lift.shadow})` } : {}),
                  }
            }
            // A card crossing the screen is something to follow, not a click being
            // acknowledged, so it takes the smooth curve (see motion.ts). Durations
            // and the opacity crossover point are shared with the code that decides
            // when the real card takes over, so the handover can't fall out of sync.
            // The pick-up is a spring instead — that one IS a click being answered.
            transition={
              f.to
                ? {
                    ...(settling ? SPRING_SETTLE : { duration: ms / 1000, ease: EASE_FOLLOW }),
                    // Only a dissolving clone needs an opacity schedule. A clone that
                    // is handed over to instead of faded out has nothing to time.
                    ...(f.reveal ? {} : { opacity: { duration: ms / 1000, times: [0, 0.86, 1] } }),
                  }
                : SPRING_ANSWER
            }
            // Arrival, not a stopwatch: fires when the values have actually finished,
            // spring tail included. Guarded on `f.to` because the pick-up settles too.
            onAnimationComplete={() => { if (f.to) arrive(f.id, f.reveal); }}
            style={{ left: 0, top: 0 }}
            dangerouslySetInnerHTML={{ __html: f.html }}
          />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
