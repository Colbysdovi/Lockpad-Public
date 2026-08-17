import * as React from "react";
import { cn } from "@/lib/utils";

// The pill at the top of a bottom-sheet drawer, and the surface you drag it by.
//
// WHY IT IS ITS OWN COMPONENT. Every drawer drew its own pill, and each one made the
// drag surface exactly as big as the pill looked: a 6px bar inside a ~26px strip. A
// fingertip covers something closer to 9mm — roughly 45px — so aiming at a 26px strip
// means missing it more often than not, which is exactly what "I have to try three
// times to close this" feels like. The strip below is 44px tall (the platform minimum
// for a touch target) while the pill inside stays the same 6px it always looked. Big
// where it counts, small where you can see it.
//
// The second half of the problem was that on most drawers the pill was pure
// decoration — a picture of a handle on something that could not be dragged at all.
// `onClose` wires up the real gesture; pass `onPointerDown` instead when the parent
// already owns the drag (the note sheet drives Framer Motion's dragControls).

/** Past this many pixels, releasing closes the sheet instead of springing back. */
const CLOSE_DISTANCE = 100;
/** …or past this speed (px per ms), so a quick flick closes without a long drag. */
const CLOSE_VELOCITY = 0.5;

export function SheetGrabber({
  onClose,
  onPointerDown,
  className,
}: {
  /** Dismiss the drawer. Given this, the grabber runs the drag gesture itself. */
  onClose?: () => void;
  /** Parent-owned drag instead (e.g. Framer Motion's `dragControls.start`). */
  onPointerDown?: (e: React.PointerEvent) => void;
  className?: string;
}) {
  const startDrag = useSheetDrag(onClose);
  return (
    <div
      // Decorative: a drawer is always dismissible some other way (its close button,
      // Escape, a tap outside), so this adds nothing for a screen reader or a keyboard.
      aria-hidden
      onPointerDown={onPointerDown ?? startDrag}
      // The browser must not read this downward drag as a page scroll.
      style={{ touchAction: "none" }}
      className={cn(
        "flex h-11 shrink-0 cursor-grab touch-none select-none items-center justify-center transition-colors active:cursor-grabbing",
        className
      )}
    >
      <div className="h-1.5 w-10 rounded-full bg-muted" />
    </div>
  );
}

// The drag itself: follow the finger down, then either close or spring back.
//
// It moves the sheet by writing a transform straight onto the dialog element rather
// than through React state — a drag redraws on every frame, and routing sixty renders
// a second through the component tree makes the sheet lag behind the finger, which is
// the one thing a drag must never do.
function useSheetDrag(onClose?: () => void) {
  return React.useCallback(
    (event: React.PointerEvent) => {
      if (!onClose) return;
      // Radix gives the drawer role="dialog"; that element IS the sheet.
      const sheet = (event.currentTarget as HTMLElement).closest<HTMLElement>('[role="dialog"]');
      if (!sheet) return;

      const startY = event.clientY;
      const startTime = event.timeStamp;
      let offset = 0;
      let lastY = startY;
      let lastTime = startTime;
      let velocity = 0;
      sheet.style.transition = "none";

      const onMove = (move: PointerEvent) => {
        const raw = move.clientY - startY;
        // Downward follows the finger exactly; upward is heavily resisted, because
        // there is nowhere for the sheet to go — it is already against the top.
        offset = raw >= 0 ? raw : raw / 6;
        const dt = move.timeStamp - lastTime;
        if (dt > 0) velocity = (move.clientY - lastY) / dt;
        lastY = move.clientY;
        lastTime = move.timeStamp;
        sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
      };

      const onEnd = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        if (offset > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) {
          // Leave the transform in place: the drawer's own exit animation takes over
          // from where the finger left it, so the close continues the gesture instead
          // of snapping back first. Cleared once that animation has run, or the sheet
          // would re-open still displaced.
          onClose();
          setTimeout(() => {
            sheet.style.transform = "";
            sheet.style.transition = "";
          }, 300);
          return;
        }
        // Not far enough: spring back to rest.
        sheet.style.transition = "transform 0.22s var(--ease-follow)";
        sheet.style.transform = "";
        setTimeout(() => { sheet.style.transition = ""; }, 250);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [onClose]
  );
}
