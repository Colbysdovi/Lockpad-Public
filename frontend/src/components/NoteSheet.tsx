import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigationType } from "react-router-dom";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import { NoteView } from "./NoteView";
import { getOpenOrigin } from "@/lib/useNoteSheet";
import { useNote } from "@/lib/hooks";
import { useFolderAccent } from "@/lib/folderColor";
import { cn } from "@/lib/utils";
import { SheetGrabber } from "@/components/ui/sheet-grabber";
import { EASE_FOLLOW, EASE_FOLLOW_REVERSED, NOTE_SWAP_FADE, setNoteSwapDirection } from "@/lib/motion";

// Opening and closing use the app's FOLLOWABLE curve (EASE_SMOOTH) and its mirror.
//
// These used to be two curves declared right here — and the opening one was, digit
// for digit, the EASE curve that motion.ts reserves for delete and nothing else.
// That curve is deliberately abrupt: it covers ~80% of the distance in the first
// quarter of its time, which is right for something being got rid of and wrong for
// a panel you are meant to watch travel. Opening a note is the most-repeated
// animation in the app and the least destructive thing you can do, so it now moves
// on the same curve as the reflow, the arriving card and the colour strip.
//
// Closing still mirrors opening rather than repeating it, so the panel shrinks back
// into its card as a true reverse. The mirror matters most for the fade: on a 1→0
// opacity an ease-OUT front-loads the transparency, so the panel would vanish in the
// first fifth and then crawl home invisibly. Accelerating away keeps it visible
// through the shrink and fades it exactly as it lands.
const EASE_OUT = EASE_FOLLOW;
const EASE_IN = EASE_FOLLOW_REVERSED;

// The grow-from-card transform: translate the (centered) modal back toward the
// clicked card and scale it down to roughly the card's width. Used for BOTH the
// open `initial` (grow out of the card) and the close `exit` (shrink back into
// the same card) so closing is a true reverse of opening. Falls back to a gentle
// centered zoom when there's no origin (opened from search / a link) or reduced
// motion is set. The origin is a stable module slot (see useNoteSheet), untouched
// until the next open, so it still resolves to the source card at close time.
function expandFrom(reduceMotion: boolean) {
  if (reduceMotion) return { opacity: 0 };
  const origin = getOpenOrigin();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!origin) return { opacity: 0, scale: 0.95 };
  const modalW = Math.min(800, vw - 32);
  return {
    opacity: 0,
    x: origin.x + origin.w / 2 - vw / 2,
    y: origin.y + origin.h / 2 - vh / 2,
    scale: Math.max(0.1, origin.w / modalW),
  };
}

/** Which note the panel should be SHOWING, which is not always the one the URL has
 *  just changed to.
 *
 *  Following a link from one open note to another used to blink, and it blinked
 *  twice for two different reasons. The panel swapped its contents the instant the
 *  id changed, so the incoming note rendered its "Loading…" line into an 86vh panel
 *  while its query was still in flight — and the swap itself waited for the outgoing
 *  note to finish fading before starting the incoming one, leaving an empty panel in
 *  between. Two flashes of nothing, back to back, in a panel that never actually
 *  went anywhere.
 *
 *  So the outgoing note stays on screen, whole, until the incoming one has data to
 *  render. Nobody watches an empty frame; the panel simply holds what it had a
 *  moment longer and then changes to the new note.
 *
 *  Two deliberate exceptions. Opening the panel from nothing is NOT held — there is
 *  no previous note to hold, and the panel's own grow-from-the-card animation is
 *  what covers that arrival. And a note that takes too long releases anyway: after
 *  half a second the swap happens regardless, so a slow or failed request shows its
 *  own loading and error states rather than silently pinning you to the note you
 *  were trying to leave. */
function useReadyNoteId(noteId: string | null): string | null {
  // Same query key NoteView uses, so this shares its cache entry and adds no request
  // of its own — it is only here to know WHEN the data arrived.
  const { data } = useNote(noteId ?? undefined);
  const [shown, setShown] = useState(noteId);

  useEffect(() => {
    if (!noteId) {
      setShown(null);
      return;
    }
    // Nothing on screen to protect, or the new note is ready: swap now.
    if (shown === null || data?.id === noteId) {
      setShown(noteId);
      return;
    }
    const timer = window.setTimeout(() => setShown(noteId), 500);
    return () => window.clearTimeout(timer);
  }, [noteId, data?.id, shown]);

  return shown;
}

/** Swap the note inside a panel that does not move, so that only the thing you are
 *  READING changes.
 *
 *  Three layers of one picture, and the split between them is the whole idea:
 *
 *    · The panel, its scroll bar and the folder accent down its left edge are the
 *      FRAME. They hold still. A frame that slides along with its contents stops
 *      reading as a frame, and a scroll bar that rides off the edge reads as the
 *      window leaving rather than the page turning.
 *    · The note's contents TRAVEL — out to the left, in from the right, the
 *      direction you moved when you followed the link. A cross-fade says "this
 *      became that"; a slide says "you went somewhere". Following a link is going
 *      somewhere, so it slides. That part lives inside NoteView, below the scroll
 *      container (see NOTE_CONTENT_SLIDE); this layer only sets the labels and
 *      Framer passes them down.
 *    · Everything in between simply FADES, this layer included, so the two notes
 *      dissolve through each other instead of one blanking before the other lands.
 *
 *  The two notes OVERLAP — both absolutely positioned, passing through each other —
 *  rather than taking turns. A sequential swap has a moment where neither is on
 *  screen, and in a panel this size that gap was the blink this replaced.
 *
 *  The accent strip is drawn HERE rather than in NoteView, where it used to live, for
 *  the same reason the scroll bar stays behind: a strip inside the note is a child of
 *  the thing that moves. Out here it is one persistent element that changes COLOUR
 *  when the note beneath it changes — a 300ms tint rather than a cut, so moving
 *  between two folders reads as one panel changing subject. It is always rendered,
 *  transparent when the note has no folder colour, so the colour has something to
 *  travel from and to instead of popping in and out of existence.
 *
 *  `initial={false}` keeps the first note from animating in on top of the panel's own
 *  opening animation — two entrances on one event read as a stutter. */
function SlideNote({ id, children }: { id: string; children: ReactNode }) {
  // Shares NoteView's cache entry for this note, so it costs no extra request — it is
  // only here to know which folder colour the edge should be wearing.
  const { data: note } = useNote(id);
  const accent = useFolderAccent(note?.folder?.id);

  // The browser's Back button is a return too, and it never goes through openNote —
  // the URL simply changes underneath us — so the direction has to be caught here.
  // Written during render rather than in an effect because the swap animation is
  // resolved in the same commit as the id change; an effect would run after it, one
  // transition too late. The ref makes it fire only on an actual note change.
  const navType = useNavigationType();
  const lastId = useRef(id);
  if (lastId.current !== id) {
    lastId.current = id;
    if (navType === "POP") setNoteSwapDirection(-1);
  }

  return (
    // overflow-hidden so the note on its way out is clipped at the panel edge instead
    // of widening it — sliding content would otherwise be scrollable overhang.
    <div className="relative h-full overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div
          key={id}
          variants={NOTE_SWAP_FADE}
          initial="enter"
          animate="center"
          exit="exit"
          className="absolute inset-0"
        >
          {children}
        </motion.div>
      </AnimatePresence>
      {/* Above the layers, so the accent is a continuous edge ON the panel rather than
          something the notes pass in front of. Last child + z-10 because each layer is
          its own stacking context. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-2 transition-colors duration-300"
        style={{ backgroundColor: accent ?? "transparent" }}
      />
    </div>
  );
}

// Desktop: a CENTERED modal (Keep-style) that expands from the clicked card over
// a uniform dim — giving the note the full reading width and letting the frosted
// header read against a clean scrim. Closes via ✕, the backdrop, or Esc.
export function DesktopNoteSheet({ noteId, onClose }: { noteId: string | null; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  // Which note is actually on screen (see useReadyNoteId). Used as `shownId ?? noteId`
  // at the point of render, where the panel is already known to be open — so the panel
  // is never rendered with nothing in it.
  const shownId = useReadyNoteId(noteId);

  // Esc closes the modal.
  useEffect(() => {
    if (!noteId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteId, onClose]);

  return (
    <AnimatePresence>
      {noteId && (
        <>
          {/* Transparent click-catcher (no dim): closes on click and lets the
              frosted header see through to the real list behind, but keeps the
              modal behaviour (list underneath is not interactive while open). */}
          <div
            key="scrim"
            className="fixed inset-0 z-40"
            onClick={onClose}
          />
          {/* Centering layer is click-through (pointer-events-none) so clicks in
              the empty margin fall to the scrim; the modal itself re-enables them. */}
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.aside
              key="modal"
              initial={expandFrom(!!reduceMotion)}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              // Closing carries its own faster ease-in transition (see EASE_IN):
              // the panel accelerates back into the card and only fades as it
              // lands, so the shrink reads as a true collapse into the source card.
              exit={{ ...expandFrom(!!reduceMotion), transition: { duration: 0.26, ease: EASE_IN } }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              style={{ transformOrigin: "center" }}
              className="note-panel surface-elevated pointer-events-auto flex h-[86vh] w-full max-w-[800px] flex-col overflow-hidden"
            >
              {/* Following a link swaps the note INSIDE the panel — see SlideNote
                  and useReadyNoteId above for why it holds the old note until the new
                  one is ready, and why the two overlap. */}
              <SlideNote id={shownId ?? noteId}>
                <NoteView id={shownId ?? noteId} onBack={onClose} />
              </SlideNote>
            </motion.aside>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

// Mobile: a bottom sheet that covers the content, with a backdrop — space is at
// a premium, so hiding the background is the right call here.
export function MobileNoteSheet({ noteId, onClose }: { noteId: string | null; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  // Same swap treatment as desktop: the sheet stays put, its contents change.
  const shownId = useReadyNoteId(noteId);
  // Swipe-to-dismiss: the drag is started ONLY from the top grab handle (below) via
  // dragControls, so it never competes with the note body's own vertical scroll.
  const dragControls = useDragControls();
  // Mirror the note title's pinned state so the grab-handle strip above it turns
  // solid at the same moment, keeping the header cap visually continuous. Reset when
  // the sheet closes so a freshly opened note starts glassy at the top.
  const [headerStuck, setHeaderStuck] = useState(false);
  useEffect(() => { if (!noteId) setHeaderStuck(false); }, [noteId]);
  return (
    <AnimatePresence>
      {noteId && (
        <>
          {/* Transparent click-catcher (no dim): closing on an outside tap while
              letting the frosted header read through to the list behind — a dim here
              fought the header's translucency. Mirrors the desktop sheet's scrim. */}
          <div
            key="backdrop"
            className="fixed inset-0 z-40"
            onClick={onClose}
          />
          <motion.div
            key="sheet"
            initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
            transition={{ duration: 0.32, ease: EASE_OUT }}
            // Drag down to dismiss. Elastic only downward; releasing past a distance
            // OR a flick velocity closes, otherwise it springs back to rest. Disabled
            // under reduced motion (the sheet cross-fades instead of sliding).
            drag={reduceMotion ? false : "y"}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_e, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}
            // Ride the keyboard inset (--kb) so the sheet shrinks to sit above the
            // software keyboard rather than extending behind it.
            style={{ bottom: "var(--kb, 0px)" }}
            // Top sits below the status bar / Dynamic Island: at least a 2rem sliver of
            // the list shows above, but on a notched device in standalone PWA (edge-to-
            // edge under a translucent status bar) it drops below the safe-area inset so
            // the grab handle + title are never hidden under the status bar.
            className="note-sheet-frosted fixed inset-x-0 bottom-0 top-[max(2rem,calc(env(safe-area-inset-top)+0.5rem))] z-50 overflow-hidden rounded-t-2xl border-t shadow-2xl"
          >
            {/* Grab handle: the sole drag surface, so the gesture never competes with
                the note body's own scrolling. Framer Motion owns the drag here (the
                sheet is a motion element with dragControls), so the grabber is handed
                the pointer rather than running its own. Its background tracks the
                title's pinned state (solid --card when stuck) so the handle + title
                read as one continuous header while scrolling. */}
            <SheetGrabber
              onPointerDown={(e) => dragControls.start(e)}
              className={cn(headerStuck && "bg-card")}
            />
            {/* Kept in step with the grabber's height (h-11 = 2.75rem) so the note
                below it still gets exactly the rest of the sheet. */}
            <div className="h-[calc(100%-2.75rem)]">
              {/* Frosted header (parity with desktop): the glass reveals the dimmed
                  list behind, fading to a solid writing surface below. */}
              <SlideNote id={shownId ?? noteId}>
                <NoteView id={shownId ?? noteId} onBack={onClose} onStuckChange={setHeaderStuck} />
              </SlideNote>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
