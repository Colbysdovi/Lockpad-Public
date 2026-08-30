import type { Variants } from "framer-motion";

// Shared motion vocabulary
// (docs/forge/micro-interactions-idea-brief.md, docs/forge/motion-audit.md).
//
// ── Motion is grouped by PURPOSE, not by feature ────────────────────────────
//
// The question a curve answers is never "which screen is this?" but "what is this
// motion doing to the user?". There are four answers, and each owns one curve:
//
//   FOLLOW  something is travelling or reshaping and the eye should track it.
//           Gently symmetric, so the movement is spread across the whole duration.
//           The default. If you are unsure, it is this one.
//
//   ANSWER  a control is responding to a press. There is no journey to watch —
//           the user already knows where it went, they want to feel it arrive.
//           A spring, because a press has weight and a spring has weight.
//
//   END     something is being destroyed. Decisive: ~80% of the distance goes by
//           in the first quarter, so the response is instant and the rest is
//           follow-through. DELETE ONLY. Nothing else has earned it.
//
//   REVERSE an action is being taken back. Never its own curve — always the
//           time-mirror of whatever it is undoing (see the undo section below).
//
// Below roughly 160ms — hover tints, focus rings, colour swaps — the curve is not
// perceptible and choosing one is false precision. Those stay on plain CSS `ease`
// and are deliberately NOT given a token here; see TINT_MS.
//
// This grouping replaced ten ad-hoc easings that had accumulated across the app,
// the worst of which was END quietly becoming the most-used curve in the codebase
// by copy-paste. If you are adding motion and none of the four fits, that is worth
// a conversation, not a new constant.

/** FOLLOW — the default. Everything the eye is meant to track. */
export const EASE_FOLLOW = [0.4, 0, 0.2, 1] as const;

/** FOLLOW, mirrored, for the closing half of anything that opened on it.
 *  A curve's time-mirror is (1-x2, 1-y2, 1-x1, 1-y1). */
export const EASE_FOLLOW_REVERSED = [0.8, 0, 0.6, 1] as const;

/** Same curve as a CSS string, for keyframes and Web Animations. */
export const EASE_FOLLOW_CSS = `cubic-bezier(${EASE_FOLLOW.join(", ")})`;

/** END — decisive. Delete only. */
export const EASE_END = [0.22, 1, 0.36, 1] as const;

/* END, mirrored — a reversed ease-out is an ease-in — is delete's undo curve, and
   it is driven entirely from CSS (`--ease-end-reversed`, used by the card-unpeel and
   card-unrecede keyframes). It had a JS twin here holding the same four numbers that
   nothing ever imported: a second copy of a value can only ever drift from the first,
   so the CSS variable is the one place it lives. */

/** ANSWER — a control responding to a press.
 *
 *  Expressed as visualDuration + bounce rather than stiffness + damping. They
 *  describe the same physics, but these two are the ones worth arguing about:
 *  `visualDuration` is how long it LOOKS like it takes (the bulk of the movement,
 *  before the settling tail), and `bounce` is how springy it feels — 0 is a clean
 *  arrival with no overshoot, 0.3 is noticeably physical.
 *
 *  THIS IS THE DIAL. If the app feels too eager, raise visualDuration; if it feels
 *  rubbery, lower bounce. Changing one does not disturb the other, which is exactly
 *  what stiffness/damping could never promise.
 *
 *  Tuned slower and calmer than the stiffness-400/damping-30 spring it replaces
 *  (which settled in ~270ms): this app is a place to think, not a place to be
 *  hurried. */
export const SPRING_ANSWER = { type: "spring", visualDuration: 0.34, bounce: 0.15 } as const;

/* PLAYFUL — the animated-icon layer, and nowhere else. Overshoots on purpose: it
   fires on hover over a toolbar glyph, a low-frequency, opt-in moment of delight
   rather than part of any task. It is CSS-only (`--ease-playful`, seven uses in
   icons.css), and the JS constant that used to sit here was an unimported duplicate
   of the same four numbers — deleted for the same reason as the END mirror above.

   And the floor: below roughly 160ms a curve stops being perceptible, so hover
   tints, focus rings and colour swaps use plain `ease` and get no token at all.
   That threshold is a fact about eyes, not a value anything needs to import. */

// ---------------------------------------------------------------------------
// Card exit choreography (delete vs archive)
//
// Durations live here rather than inline so the code that has to WAIT for an exit
// (the cache reconcile that finally unmounts the card) can't drift out of sync with
// the animation that's playing.
// ---------------------------------------------------------------------------

// Delete keeps its original, brisk timing on purpose: it is the one action whose
// subject the user has decided they no longer want to look at. Lingering over it
// would be the app second-guessing a decision that has already been made (and it
// stays undoable from the toast either way).
/** Delete — strikethrough, hold, then the rotate-and-fade "peel". */
export const DELETE_STRIKE_MS = 165;
export const DELETE_HOLD_MS = 100;
export const DELETE_PEEL_MS = 265;
/** Bulk delete skips straight to the peel, lightly staggered (capped). */
export const DELETE_BULK_STAGGER_MS = 35;
export const DELETE_BULK_STAGGER_CAP = 8;

/** Archive — recede (scale + desaturate + shadow flatten), fading only at the end.
 *  Slower than delete: filing something away is a considered act, and the note still
 *  exists, so the card should be seen settling back rather than being got rid of. */
export const ARCHIVE_RECEDE_MS = 320;
export const ARCHIVE_TOTAL_MS = 400;
/** The final window in which opacity drops — still short, so the fade is the last
 *  thing that happens rather than the thing the user reads as "gone". */
export const ARCHIVE_FADE_MS = 120;

/** Colour's "mark" axis — the folder-derived accent strip drawing on and erasing.
 *  This is pure information ("this note now belongs to that folder"), with no
 *  urgency attached, so it is the slowest of the card animations: the stroke should
 *  be watchable as a stroke. Erase stays shorter than draw — undoing a mark is
 *  quicker than making one — and doubles as the handoff delay when a note moves
 *  between two coloured folders, so the old colour is fully gone before the new one
 *  starts (see NoteCard; a single constant keeps the two from drifting apart). */
export const ACCENT_DRAW_MS = 380;
export const ACCENT_ERASE_MS = 240;

/** A composed note joining the list. */
export const CARD_ARRIVE_MS = 420;

/** The bottom slot changing hands: the composer and the bulk-action bar swapping
 *  places when a second note is ticked, and swapping back when the selection drops
 *  below two.
 *
 *  Both bars live in the SAME absolutely-positioned slot at the bottom of the list,
 *  so the swap is a handover rather than two independent entrances. Whichever bar is
 *  leaving drops straight down out of the viewport; whichever is arriving rises from
 *  below the same edge. Sharing these three numbers between the two components is
 *  what keeps the handover reading as one movement — tuned in one file, they cannot
 *  drift into two different gestures happening at once.
 *
 *  ── Why the arrival TRAILS the departure ───────────────────────────────────
 *
 *  Run simultaneously, the two bars cross: one descending and one ascending through
 *  the same band of pixels at the same moment, two opaque cards of similar size
 *  overlapping in the middle of the gesture. It reads as a collision, not a swap.
 *  The trail lets the outgoing bar mostly clear the edge before the incoming one
 *  appears at it, so the slot reads as being handed over. It is deliberately shorter
 *  than OUT_MS — a clean sequence with no overlap at all would put the total past
 *  half a second, which is far too slow a response to ticking a checkbox.
 *
 *  The durations and curves are the composer's own existing push-down, reused rather
 *  than re-picked: the composer already slides out of this slot exactly like this
 *  when a note opens over the list, and a second, different way of leaving the same
 *  slot would be one gesture too many. Out uses the ease-out curve (it is leaving,
 *  and should commit early); in uses the mirrored one, matching how the composer
 *  already returns. */
export const BAR_SWAP_OUT_MS = 300;
export const BAR_SWAP_IN_MS = 260;
export const BAR_SWAP_TRAIL_MS = 130;

/** How far a bar travels to leave its slot. Past 100% so it clears its own bottom
 *  padding and the safe-area inset as well as its own height — at exactly 100% the
 *  bar's lower edge stops level with the slot's, leaving it peeking. */
export const BAR_SWAP_OFFSCREEN = "130%";

/** Card travel (pin's lift, duplicate's stack), drawn by a clone in the fx overlay. */
export const FLY_MS = { lift: 520, stack: 500 } as const;

/** How a picked-up clone sits while it waits, PER ACTION.
 *
 *  Split by kind on purpose. The two actions are asking the lift to do different
 *  jobs, and tuning duplicate's legibility used to drag pin's appearance along with
 *  it, which is a side effect nobody asked for.
 *
 *  PIN ("lift") is a card being carried from one container to another. The journey
 *  is the explanation, and the user is watching the card cross the screen, so the
 *  pick-up only has to acknowledge the click. These are its long-standing values and
 *  they are deliberately left alone.
 *
 *  DUPLICATE ("stack") has no journey to watch — the copy lands in the slot beside
 *  its original — so the pick-up is carrying the whole story: two cards, one lifted
 *  clear, the other still on the surface with its edge showing underneath. That only
 *  reads if the original is actually left uncovered, which is a matter of geometry
 *  rather than taste. Scaling up 3% grows the clone by half that on each side, so an
 *  offset only exposes the original by (offset − growth): at a ~330pt card, x:-20
 *  leaves about 15pt of the original showing down its right edge and y:-22 about
 *  17pt along the bottom. A 6% scale with a 10pt offset — the previous attempt —
 *  nets out to roughly nothing, which is why the pair still read as one card.
 *
 *  The offset points UP AND LEFT because that is where the copy is going: a
 *  duplicate sorts immediately ahead of its original, so it leans towards its slot.
 *
 *  The shadow is a `drop-shadow` filter rather than a box-shadow, so it can animate
 *  back to literally nothing. Plain black rather than a palette token, deliberately:
 *  this is depth, not colour, and it should read the same in both themes.
 *
 *  `restShadow` is what the clone sits on underneath that filter, and it is the fix
 *  for the blink at the end of the settle. A card at rest in the list is `shadow-sm`;
 *  the clone was `shadow-xl` throughout. So at the handover a big soft shadow
 *  crossfaded into a tight one in a single step and the card appeared to drop its
 *  substance for a frame — read as a blink. Duplicate's clone now rests on the same
 *  `shadow-sm` the real card does and takes ALL of its elevation from the filter, so
 *  by the time the real card takes over the two are indistinguishable. Pin keeps
 *  `shadow-xl`, unchanged.
 *
 *  `rotate` is a small tilt while held — a copy peeled off a stack does not come away
 *  perfectly square. It unwinds to zero as the card settles, which is where most of
 *  the life in the movement comes from. Two degrees: enough to read as a tilt at a
 *  glance, not enough to look like a gimmick. Pin stays square. */
export const FLY_LIFT = {
  lift: { scale: 1.04, x: 0, y: 0, rotate: 0, shadow: null, restShadow: "shadow-xl" },
  stack: { scale: 1.03, x: -20, y: -22, rotate: -2, shadow: "0 24px 40px rgba(0,0,0,0.30)", restShadow: "shadow-sm" },
} as const;
/** What the filter animates back to — a shadow with no size and no colour. */
export const FLY_NO_SHADOW = "drop-shadow(0 0 0 rgba(0,0,0,0))";

/** Under this much distance the clone is already sitting over its destination, and
 *  there is no travel to animate — only a descent. Duplicating into the slot beside
 *  the original is exactly this case: the copy takes the original's old position, so
 *  its start and end rectangles are the SAME ONE and the flight is zero pixels long.
 *  Playing a 500ms cross-screen travel over zero pixels is what made it read as a
 *  blink rather than a movement. */
export const SETTLE_IN_PLACE_PX = 24;
/** A pure descent — no distance to cover, so it only has to be long enough to be
 *  seen as lowering rather than snapping. */
export const SETTLE_MS = 300;

/** ANSWER, dialled for landing rather than for a button press.
 *
 *  A settle-in-place is not a journey — there is nowhere to watch it go — so FOLLOW
 *  is the wrong answer: a tween with a fixed end reads as the card being pushed down
 *  onto the surface and stopping dead. What it actually is, is an object coming to
 *  rest under its own weight, and the vocabulary already has a curve with weight in
 *  it. This is that curve on different dial settings, not a fifth curve: slower than
 *  a press (it is arriving, not answering) and barely springy (0.08 lands softly;
 *  the 0.15 of a press would read as a bounce).
 *
 *  A copy with a real journey ahead of it still travels on FOLLOW — the eye is
 *  tracking it across the grid, which is exactly what FOLLOW is for. */
export const SPRING_SETTLE = { type: "spring", visualDuration: 0.42, bounce: 0.08 } as const;

/** The clone holds full opacity until this far through its flight, then dissolves. */
const FLY_OPAQUE_UNTIL = 0.86;
/** Straight-line distance between two on-screen rectangles' origins. */
export function flyDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
/** How long this particular flight should take. A real journey keeps its full
 *  duration; a settle-in-place gets the short descent instead. */
export function flyDurationMs(kind: keyof typeof FLY_MS, distance: number): number {
  return distance <= SETTLE_IN_PLACE_PX ? SETTLE_MS : FLY_MS[kind];
}
/** When the real card takes over — mid-dissolve, so the handover is a crossfade. */
export function flyRevealMs(ms: number): number {
  return Math.round(ms * FLY_OPAQUE_UNTIL);
}
/** How long after the real card takes over its attention pulse fires. Just enough to
 *  read as a consequence of the arrival rather than as part of it. */
export const HIGHLIGHT_AFTER_REVEAL_MS = 40;
/** When the settled card pulses, just after it has taken over. */
export function flyHighlightMs(ms: number): number {
  return flyRevealMs(ms) + HIGHLIGHT_AFTER_REVEAL_MS;
}
/** Slack added to a clone's cleanup deadline when its landing is driven by the
 *  animation finishing rather than by a timer. A spring has no fixed end — the docs
 *  are explicit that the bouncy tail plays out AFTER `visualDuration` — so a deadline
 *  derived from any single number is early by an unknown amount. This is a backstop
 *  for the case where the completion callback never arrives at all (a hidden tab
 *  pauses the frame loop), not a schedule anything is timed against. */
export const FLY_SETTLE_TAIL_MS = 400;
/** When the spent clone may be dropped from the overlay. */
export function flyCleanupMs(ms: number): number {
  return ms + 100;
}
/** Cleanup for a flight whose kind isn't at hand — safe for any of them. A clone
 *  that lingers is already fully transparent and inert, so erring long is free. */
export const FLY_CLEANUP_MAX_MS = Math.max(...Object.values(FLY_MS)) + 100;
/** How long a picked-up clone may hold without a destination before giving up. */
export const FLY_HOLD_MAX_MS = 2500;

/** Reduced-motion fallback: everything collapses to a plain fade. */
export const REDUCED_FADE_MS = 150;

/** How long the list takes to open (or close) a slot before a card travels into it.
 *  The reflow is its own beat: the space appears, the neighbours slide over to make
 *  it, and only then does the card fly in. Overlapping the two reads as chaos.
 *
 *  Deliberately slower than the other tweens. Everything else here animates ONE card
 *  that the user is already looking at; this moves the whole grid at once, and a
 *  wholesale rearrangement needs long enough to be followed rather than merely
 *  noticed. Below roughly a third of a second it stops reading as movement at all —
 *  it reads as the list having glitched. */
export const REFLOW_MS = 420;

/** How long the sidebar takes to arrive or leave, and the page content to move
 *  aside for it.
 *
 *  Same reasoning as REFLOW, and deliberately the same number. Every other tween
 *  in this file animates one card, or one bar, that the user is already looking
 *  at. These two move the ENTIRE layout at once — a 16rem panel travelling in or
 *  out of the viewport and the whole note grid sliding across to make room — and a
 *  wholesale rearrangement needs long enough to be followed rather than merely
 *  noticed. At the 300ms it ran at before, the sidebar did not read as arriving;
 *  it read as the page having jumped and then caught up.
 *
 *  One constant covers both presentations. On desktop the panel pushes the content
 *  aside, on a phone it slides over the top, but it is the same control performing
 *  the same gesture, and two different speeds for one named thing is exactly the
 *  drift the rest of this file exists to prevent.
 *
 *  This is a dial. If it starts to feel slow in daily use, lower it — but not below
 *  roughly a third of a second, where movement of this size stops reading as
 *  movement at all. */
export const SIDEBAR_MS = 420;

/** How long the list HOLDS STILL before it starts opening a slot, when the card that
 *  is going to fill that slot is already travelling towards it.
 *
 *  Order is the whole point. A gap that appears first and is filled afterwards reads
 *  as the list preparing a space and the card being dropped into it — two unrelated
 *  events. Real objects do not work that way: the thing arrives, and everything else
 *  gets out of its way because it is arriving. So the copy leaves its original first,
 *  the neighbours sit still for this long while it sets off, and only then do they
 *  slide — the reflow reads as a consequence of the travel rather than a preparation
 *  for it.
 *
 *  Short on purpose. Long enough that the eye registers the copy moving before
 *  anything else does, not so long that the list looks like it is lagging behind. */
export const REFLOW_TRAIL_MS = 140;

/** How long after a card SETS OFF the list waits before opening the slot it is
 *  flying into — for the actions where the two are separated by a network round trip.
 *
 *  REFLOW_TRAIL_MS above is measured from the cache reconcile, which works for
 *  duplicate because the copy launches out of the same beat. Pin cannot use it. The
 *  card being pinned moves between two containers, so its destination does not exist
 *  until both queries have refetched and rendered it, and the clone has nowhere to fly
 *  to until then. Measured on a local server: the click landed at 0, the list reflowed
 *  from 80ms to 500ms, and the card only set off at 140ms — so the space finished
 *  opening while the card was still less than a third of the way there. Every part of
 *  the sequence was correct except the order, which is the part that carries the
 *  meaning: it read as the list preparing a gap and the card being posted into it.
 *
 *  So pin's reflow is HELD, paused, until the flight actually launches, and this is
 *  how far into that flight it is let go. The number is derived rather than picked:
 *  starting the reflow this late puts its last frame on the card's arrival, so the
 *  neighbours are still sliding out of the way for the whole journey and come to rest
 *  exactly as the card lands on the slot they just vacated. It stays correct if either
 *  duration is retuned, and clamps to zero if the reflow ever becomes the slower of
 *  the two — in which case it has to start immediately to finish in time at all. */
export const REFLOW_AFTER_LAUNCH_MS = Math.max(0, FLY_MS.lift - REFLOW_MS);

/** A held reflow is released by the flight it is waiting for. If that flight never
 *  launches — the request failed, the destination never rendered — the grid must not
 *  stay frozen mid-rearrangement, so the hold gives up on its own after this long and
 *  the cards slide anyway. A backstop, not a schedule. */
export const REFLOW_HOLD_BAIL_MS = 1500;

/** How much of the reflow must have played before a copy that is settling IN PLACE
 *  starts coming down.
 *
 *  Whoever has further to go moves first. A copy with a real journey ahead of it sets
 *  off immediately and the list clears a path as it comes — that is the long-distance
 *  case, and it reads well. A copy that is already hovering over its destination has
 *  no journey at all, so leading with it means leading with nothing; there the order
 *  has to be the other way round. It waits, lifted, while the original slides out
 *  from underneath it and shoves the rest of the list along, and only then does it
 *  come down into the space that was just vacated.
 *
 *  Not the full reflow: starting the descent a little before the list has finished
 *  settling overlaps the two beats, which reads as one continuous movement rather
 *  than as stop, start. */
export const SETTLE_AFTER_REFLOW = 0.55;

/** How long a clone waits, held aloft, before it starts moving to its slot. */
export function settleDelayMs(distance: number): number {
  return distance <= SETTLE_IN_PLACE_PX ? REFLOW_TRAIL_MS + Math.round(REFLOW_MS * SETTLE_AFTER_REFLOW) : 0;
}

/** The reflow uses the shared FOLLOW curve. */
export const EASE_REFLOW = EASE_FOLLOW_CSS;

// ---------------------------------------------------------------------------
// Undo = the exit, played backwards
//
// Undoing an action should look like rewinding it, so each reverse animation is the
// time-mirror of the exit it undoes: the same beats in the opposite order, over the
// same wall-clock, on the MIRRORED easing curve (an exit's ease-out becomes an
// entrance's ease-in). The numbers are therefore derived from the exit constants
// above rather than re-tuned, and stay correct if those are re-tuned.
// ---------------------------------------------------------------------------

/** Both mirrors are described with the vocabulary at the top of this file:
 *  `--ease-end-reversed` (CSS) for delete's undo, EASE_FOLLOW_REVERSED for anything
 *  that opened on FOLLOW. */

/** Delete undo: un-peel (card flies back), hold, then the strikethrough retracts.
 *  Only the timings JS actually reads live here — the un-peel's own duration is
 *  spelled out in the `card-unpeel` keyframe and had an unused constant here. */
export const UNDO_UNSTRIKE_DELAY_MS = DELETE_PEEL_MS + DELETE_HOLD_MS;
export const UNDO_UNSTRIKE_MS = DELETE_STRIKE_MS;

/** Archive undo: fade back in first, then grow and re-saturate out of the canvas. */
export const UNDO_UNRECEDE_MS = ARCHIVE_TOTAL_MS;

/** Capped stagger for a BULK undo, mirroring the bulk exit's own stagger. */
export const UNDO_BULK_STAGGER_MS = DELETE_BULK_STAGGER_MS;
export const UNDO_BULK_STAGGER_CAP = DELETE_BULK_STAGGER_CAP;

/** Total wall-clock of an undo, so callers know when the card is settled again. */
export function undoDurationMs(kind: "delete" | "archive", opts: { reduced?: boolean } = {}): number {
  if (opts.reduced) return REDUCED_FADE_MS;
  return kind === "archive" ? UNDO_UNRECEDE_MS : UNDO_UNSTRIKE_DELAY_MS + UNDO_UNSTRIKE_MS;
}

/** Total wall-clock of an exit, so callers know when the card may be unmounted. */
export function exitDurationMs(
  kind: "delete" | "archive",
  opts: { bulk?: boolean; reduced?: boolean; index?: number } = {}
): number {
  if (opts.reduced) return REDUCED_FADE_MS;
  if (kind === "archive") return ARCHIVE_TOTAL_MS;
  const stagger = opts.bulk
    ? Math.min(opts.index ?? 0, DELETE_BULK_STAGGER_CAP) * DELETE_BULK_STAGGER_MS
    : 0;
  return opts.bulk
    ? DELETE_PEEL_MS + stagger
    : DELETE_STRIKE_MS + DELETE_HOLD_MS + DELETE_PEEL_MS;
}

/** Locking a note: the contents blur into disappearance, then the locked state
 *  (padlock + explanation) fades in behind them. Long enough to read as the note
 *  being sealed rather than as a repaint, short enough not to sit in the way. */
export const LOCK_BLUR_MS = 420;
export const LOCK_REVEAL_MS = 320;

/** How long to hold the blurred-out state before giving up on the refresh that
 *  redacts the note. Without this a slow (or failed) refetch would leave the
 *  content faded to nothing with no locked state to replace it. */
export const LOCK_BAIL_MS = 2000;

// ---------------------------------------------------------------------------
// Following a link from one open note to another
// ---------------------------------------------------------------------------
//
// The panel does not go anywhere — you did. So the CONTENT travels (out to the
// left, in from the right, the direction you moved) while everything that belongs
// to the panel rather than to the note stays put and simply changes: the frame,
// the folder accent down the left edge, and the scroll bar on the right. A frame
// that slides along with its contents stops reading as a frame.
//
// That split is why this is two coordinated variant sets rather than one animation.
// NoteSheet drives the labels on the layer that owns the panel chrome, and fades it;
// NoteView applies NOTE_CONTENT_SLIDE inside its scroll container, so the words move
// while the scroll bar the words are scrolled by does not. Framer propagates the
// label down through the component tree, so NoteView needs no props for this and
// renders perfectly still anywhere the labels aren't being driven.
//
// The travel is a PERCENTAGE of the note's own width, not a pixel count, so it stays
// in proportion on a phone and in an 800px desktop modal. It is a short push rather
// than a full carousel sweep: with the fade underneath it, a short distance reads as
// a slide without turning body text into a blur crossing the panel. Out is quicker
// than in, so the arriving note is what the eye settles on.
const NOTE_SWAP_IN = { duration: 0.28, ease: EASE_FOLLOW } as const;
const NOTE_SWAP_OUT = { duration: 0.2, ease: EASE_FOLLOW } as const;
const NOTE_SWAP_TRAVEL = "6%";

// WHICH WAY the next swap travels. Forward (+1) by default: you followed a link
// deeper, so the old note leaves to the left and the new one arrives from the right.
// Backward (-1) when you are RETURNING — clicking a backlink, or the browser's Back
// button — and then the whole thing plays in reverse: the note you are on leaves to
// the right and the one you came from slides back in from the left, retracing the way
// you arrived. Direction is the only thing separating "going somewhere" from "coming
// back", and getting it wrong makes a return feel like another departure.
//
// It is a module slot rather than a prop for the same reason `openOrigin` in
// useNoteSheet is: the two ends of this animation are set by different components at
// different moments (whatever was clicked decides, the panel performs), and the
// EXITING note cannot be told anything — AnimatePresence keeps its last rendered
// element, props frozen, so a prop set after the click would never reach it. A
// function variant sidesteps that: it is resolved when the animation STARTS, at which
// point both the arriving and the departing note read the same slot and agree.
let swapDirection = 1;

/** Aim the next note-to-note swap. Called by openNote (see useNoteSheet) and by the
 *  panel when the navigation was a browser POP. */
export function setNoteSwapDirection(direction: 1 | -1) {
  swapDirection = direction;
}

/** The panel-side layer: fades only, and the fade is the same either way round. */
export const NOTE_SWAP_FADE: Variants = {
  enter: { opacity: 0, transition: NOTE_SWAP_IN },
  center: { opacity: 1, transition: NOTE_SWAP_IN },
  exit: { opacity: 0, transition: NOTE_SWAP_OUT },
};

/** The note-side content: slides, inside the scroll container that doesn't. Both
 *  halves read `swapDirection` at resolve time, so they always travel the same way. */
export const NOTE_CONTENT_SLIDE: Variants = {
  enter: () => ({ x: swapDirection > 0 ? NOTE_SWAP_TRAVEL : `-${NOTE_SWAP_TRAVEL}`, transition: NOTE_SWAP_IN }),
  center: { x: 0, transition: NOTE_SWAP_IN },
  exit: () => ({ x: swapDirection > 0 ? `-${NOTE_SWAP_TRAVEL}` : NOTE_SWAP_TRAVEL, transition: NOTE_SWAP_OUT }),
};

/** Reduced motion: the fade still happens (it has to, or notes would cut), but
 *  nothing travels. The whole point of the setting is that things stop flying. */
export const NOTE_CONTENT_STILL: Variants = {
  enter: { x: 0 },
  center: { x: 0 },
  exit: { x: 0 },
};

/** Changing the interface language: how long the app stays behind the veil.
 *
 *  This is a DELIBERATE PAUSE, not a measurement of anything. Switching language is
 *  instantaneous — the catalogue is already in the bundle and React re-renders in a
 *  frame — and an instant switch reads as nothing having happened. The blur and the
 *  spinner give the change a beat, so it registers as the app doing something rather
 *  than as a flicker.
 *
 *  Worth being honest in the code about what that means: this makes the app slower on
 *  purpose. It is a choice about how the change should FEEL, and the number is here
 *  rather than inline so it can be tuned or, by setting it to 0, removed.
 *
 *  1200ms is long enough to read as work and short enough not to become a wait. Under
 *  about 600ms the veil looks like a glitch; past about two seconds a person who
 *  switches language twice starts to notice they are being held.
 *
 *  The locale changes DURING the hold rather than at either end of it. See
 *  LANGUAGE_SWAP_DELAY_MS. */
export const LANGUAGE_SWITCH_MS = 1200;

/** How long the veil takes to arrive and to leave. The exit is slower: the arrival is
 *  a response to a click and should feel prompt, while the departure is a reveal and
 *  wants to be watched. */
export const LANGUAGE_VEIL_IN_MS = 220;
export const LANGUAGE_VEIL_OUT_MS = 420;

/** How long after the click the interface actually changes language.
 *
 *  This exists because of a bug you could see: the language used to swap the instant
 *  the button was clicked, while the veil was still fading in over 220ms. React
 *  re-renders in a frame, so the whole interface visibly changed language through a
 *  half-transparent, half-blurred veil — the reader watched the switch happen and
 *  THEN got a spinner, which is the exact flicker the veil was built to hide. The
 *  animation was decorating a change that had already finished.
 *
 *  So the swap waits until the veil is fully opaque and the blur is at full strength.
 *  320ms is LANGUAGE_VEIL_IN_MS plus about 100ms of margin, which covers the frame or
 *  two between the click and the class landing on <html>, and a slow frame besides.
 *  Everything visible then happens behind cover: the strings change, the layout
 *  reflows around longer French words, and the Settings control moves its tick to the
 *  chosen language. What the veil lifts on is an app that is already translated.
 *
 *  It must stay comfortably below LANGUAGE_SWITCH_MS. If the two ever met, the
 *  language would change as the veil left, which is the original bug again in slow
 *  motion. The gap between them (~880ms) is the translated-but-covered pause that
 *  makes the change feel like work. */
export const LANGUAGE_SWAP_DELAY_MS = 320;
