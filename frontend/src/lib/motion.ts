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

/** Card travel (pin's lift, duplicate's stack), drawn by a clone in the fx overlay. */
export const FLY_MS = { lift: 520, stack: 500 } as const;
/** The clone holds full opacity until this far through its flight, then dissolves. */
const FLY_OPAQUE_UNTIL = 0.86;
/** When the real card takes over — mid-dissolve, so the handover is a crossfade. */
export function flyRevealMs(kind: keyof typeof FLY_MS): number {
  return Math.round(FLY_MS[kind] * FLY_OPAQUE_UNTIL);
}
/** When the settled card pulses, just after it has taken over. */
export function flyHighlightMs(kind: keyof typeof FLY_MS): number {
  return flyRevealMs(kind) + 40;
}
/** When the spent clone may be dropped from the overlay. */
export function flyCleanupMs(kind: keyof typeof FLY_MS): number {
  return FLY_MS[kind] + 100;
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
