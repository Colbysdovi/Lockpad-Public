// Did the note the user just quick-created actually land where they could see it?
//
// Plain Enter in the composer creates a note and stays put. That is the whole
// feature, and it only works if the user trusts it worked — a create with no
// editor opening and no card visibly arriving is indistinguishable from a create
// that failed. The card's arrival animation and highlight ring are the
// confirmation, so everything here exists to answer one question: was that
// confirmation actually on screen?
//
// Two real cases put it off screen, and they arrive by completely different routes:
//
//   1. The list is scrolled down. New notes sort to the TOP (the API orders by
//      updatedAt desc — backend/src/routes/notes.ts), so a note created while
//      reading something further down lands somewhere the user is not looking.
//   2. The note does not belong to this list at all. The composer pre-fills its
//      folder from the current page, but the folder picker lets you change it — set
//      it to another folder while standing on a folder page and the new note is
//      filtered straight out of the view you are looking at.
//
// Rather than re-deriving the list's filter rules here and keeping two copies of
// them in sync forever, both cases are answered the same way: look for the card in
// the DOM once the refetch has rendered, and test what is really there. Case 2 finds
// nothing; case 1 finds something outside the viewport. One mechanism, no duplicated
// logic, and it stays correct if the list's ordering or filtering ever changes.

import { findCardEl } from "./noteFx";

/** How long to keep looking for the new card before giving up.
 *
 *  The card cannot appear until the create resolves, the list query is invalidated,
 *  the refetch returns and React commits — so the answer is never available on the
 *  frame we ask. This is generous enough to cover a slow local round trip and short
 *  enough that a confirmation toast still feels like a response to the keypress
 *  rather than an unrelated message arriving later.
 *
 *  Timing out is not a failure: giving up means "no card appeared", which is exactly
 *  the answer for a note that was filtered out of this list. The caller treats the
 *  timeout and a genuinely-off-screen card identically, because from the user's side
 *  they are the same thing — nothing was seen to arrive. */
const PROBE_TIMEOUT_MS = 900;

/** How much of the card has to be inside the viewport to count as seen.
 *
 *  Not "any pixel": a card whose bottom two pixels clear the top edge has not shown
 *  anybody anything, and treating that as confirmation is how a feature ends up
 *  technically correct and practically useless. Half the card is the point where the
 *  arrival animation and the highlight ring are both unmistakably visible. */
const VISIBLE_FRACTION = 0.5;

/** The scrolling box a card lives in, or null if it is not in one.
 *
 *  The list is what scrolls, not the page, so the list's own box is the viewport
 *  that matters — testing against the window would call a card visible while it sat
 *  behind the top bar. Walking up to find it (rather than being handed a ref) keeps
 *  this usable from the composer, which has no relationship to the list component. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/** True when enough of this card is inside its scroll container to have been seen.
 *
 *  Known imprecision, deliberately left: the floating composer sits OVER the bottom
 *  of the list, so a card in the last few rows can pass this test while being partly
 *  covered by the composer itself. Correcting for it would mean this module knowing
 *  the composer's height, which is a coupling that buys very little — the card is
 *  still arriving right next to where the user is already looking, which is the
 *  thing being confirmed. */
export function isCardVisible(el: HTMLElement): boolean {
  const box = scrollParentOf(el);
  const view = box
    ? box.getBoundingClientRect()
    : { top: 0, bottom: document.documentElement.clientHeight };
  const rect = el.getBoundingClientRect();
  if (rect.height === 0) return false;
  const visible = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
  return visible >= rect.height * VISIBLE_FRACTION;
}

/** How often to look. Fine enough that the answer lands within a frame or two of the
 *  card actually rendering, coarse enough that the whole probe is a handful of
 *  cheap DOM reads rather than one per frame. */
const PROBE_INTERVAL_MS = 50;

/** Wait for a note's card to render, then report whether it can be seen.
 *
 *  Polled rather than watched with a MutationObserver: the card arrives through a
 *  React commit we do not control, and an observer would have to filter every
 *  unrelated mutation the list makes anyway. A loop that stops the moment it finds
 *  what it wants costs nothing measurable over the third of a second it typically
 *  runs, and it stops on its own if the card never comes.
 *
 *  Polled on a TIMER, not on animation frames, and that is not interchangeable: a
 *  browser stops serving requestAnimationFrame entirely to a backgrounded tab, so a
 *  frame loop would simply never resolve there. Nothing downstream is waiting on the
 *  note itself — the note is already created and saved by the time this runs — but a
 *  promise that never settles is a leak, and a confirmation that never arrives
 *  because the user switched tabs mid-capture is the exact anxiety this feature is
 *  meant to remove. Timers are throttled in a background tab rather than stopped,
 *  so the probe still finishes, just later.
 *
 *  Resolves `true` only when the card is both present AND visible; `false` covers
 *  present-but-off-screen and never-appeared alike. */
export function waitForVisibleCard(noteId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const el = findCardEl(noteId);
      // Found it and it is on screen — the arrival signal did its job, nothing more
      // is owed. Answer immediately rather than waiting out the deadline.
      if (el && isCardVisible(el)) return resolve(true);
      // Found it but off screen. Keep looking rather than answering now: the list
      // may still be settling (the reflow beat moves every card after an insert),
      // and a card measured mid-reflow can read as off screen a moment before it
      // is not. The deadline is what ends this, not the first negative reading.
      if (Date.now() - started >= PROBE_TIMEOUT_MS) return resolve(false);
      window.setTimeout(tick, PROBE_INTERVAL_MS);
    };
    window.setTimeout(tick, 0);
  });
}
