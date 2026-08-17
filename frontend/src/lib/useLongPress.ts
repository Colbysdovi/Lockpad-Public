import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

// Press and hold, for touch screens.
//
// A note card reveals its action bar on hover, which a finger does not have. This
// supplies the touch equivalent: hold a card for ~450ms and the same controls
// appear. Mouse pointers are ignored outright — desktop already has :hover, and
// running both would make a slow click reveal things twice.
//
// Three things make it feel like a press and not an accident:
//   - it waits for the press to be STATIONARY. Any movement past a few pixels is a
//     scroll, not a hold, so the timer is cancelled — otherwise flicking through a
//     long list would keep popping controls open under the thumb.
//   - it fires a short haptic tick, so the reveal is felt as well as seen.
//   - it swallows the click that follows. A long press ends with a pointerup, which
//     the browser turns into a click, which would open the note — exactly what the
//     user did not ask for. `firedRef` is the flag the card reads to ignore it.
export function useLongPress(
  onLongPress: () => void,
  { delay = 450, moveTolerance = 10 }: { delay?: number; moveTolerance?: number } = {}
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse") return; // desktop reveals via :hover
      firedRef.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        firedRef.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, delay);
    },
    [onLongPress, delay]
  );

  // Movement means the user is scrolling, not holding — abandon the press.
  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (!origin.current) return;
      if (
        Math.abs(e.clientX - origin.current.x) > moveTolerance ||
        Math.abs(e.clientY - origin.current.y) > moveTolerance
      ) {
        clear();
      }
    },
    [clear, moveTolerance]
  );

  return {
    // Spread onto the pressable element.
    handlers: { onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear },
    // Read in onClick: if true, a long-press just fired — swallow the click.
    firedRef,
  };
}
