import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

// The looping timelines the preview panes run.
//
// These exist because a still picture of an interface only shows what it looks
// like, and half of what is worth knowing about a feature is what it DOES. A locked
// note is a padlock and a grey box until you have watched one seal itself; then it
// is obvious. So each pane runs a short loop that performs the thing the step is
// describing, using — wherever possible — the product's own animation rather than an
// imitation of it.
//
// Two rules they all follow:
//
//   1. They are decorative. Every pane is `inert` and aria-hidden, so nothing here is
//      load-bearing for understanding; a person who never sees a loop still reads a
//      complete step. That is what makes it acceptable for them to be motion.
//   2. They stop dead under `prefers-reduced-motion`. A loop is the worst kind of
//      motion for someone who asked for less of it, because it never ends — so these
//      do not degrade to something shorter, they simply never start.

/** Drives a repeating sequence of phases. Returns the current phase index.
 *
 *  `steps` is a list of durations in ms; the loop walks them and wraps. Timers rather
 *  than CSS animation events, for the same reason the welcome animation uses them:
 *  an animation callback does not fire if the tab is backgrounded mid-flight, and a
 *  loop that silently stops is worse than one that never ran. */
export function useLoop(steps: number[], active: boolean): number {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState(0);
  // Held in a ref so changing the timings never restarts the loop mid-cycle.
  const timings = useRef(steps);
  timings.current = steps;

  useEffect(() => {
    if (!active || reduceMotion) {
      setPhase(0);
      return;
    }
    let cancelled = false;
    let timer = 0;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        i = (i + 1) % timings.current.length;
        setPhase(i);
        tick();
      }, timings.current[i]);
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, reduceMotion]);

  return reduceMotion ? 0 : phase;
}

/** Types a string out one character at a time, then holds, then clears — the shape of
 *  someone actually using a composer rather than a field that fills instantly.
 *
 *  Returns the text so far, whether it has finished, and whether the composer should
 *  be showing its FOCUSED state. Focus is a separate signal because it starts before
 *  the first character does: in the real app you click into the bar, it lifts, and
 *  then you type. Deriving focus from "has some text" instead would have the bar
 *  rising while the sentence is already underway, which is a different gesture — the
 *  composer reacting to the writing rather than being opened to write in. */
export function useTypewriter(
  text: string,
  active: boolean,
  opts?: { charMs?: number; holdMs?: number; gapMs?: number; leadMs?: number },
) {
  const reduceMotion = useReducedMotion();
  const charMs = opts?.charMs ?? 55;
  const holdMs = opts?.holdMs ?? 1900;
  const gapMs = opts?.gapMs ?? 700;
  // Long enough for the lift to be a separate event from the typing, short enough
  // that nobody waits through it.
  const leadMs = opts?.leadMs ?? 420;
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!active || reduceMotion) {
      // Reduced motion still gets the finished sentence — the point of the pane is
      // that the composer holds text, and that survives without any of the movement.
      setTyped(reduceMotion ? text : "");
      setFocused(!!reduceMotion);
      return;
    }
    let cancelled = false;
    let timer = 0;
    const run = () => {
      // The bar lifts first, then the sentence arrives into it.
      setFocused(true);
      timer = window.setTimeout(() => {
        if (cancelled) return;
        let i = 0;
        const step = () => {
          if (cancelled) return;
          if (i <= text.length) {
            setTyped(text.slice(0, i));
            i += 1;
            timer = window.setTimeout(step, charMs);
          } else {
            timer = window.setTimeout(() => {
              if (cancelled) return;
              // Clearing and un-focusing together, so the bar settles back down as
              // the note leaves it. That is what blurring an empty composer does.
              setTyped("");
              setFocused(false);
              timer = window.setTimeout(run, gapMs);
            }, holdMs);
          }
        };
        step();
      }, leadMs);
    };
    run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, active, reduceMotion, charMs, holdMs, gapMs, leadMs]);

  return { typed, focused, done: text.length > 0 && typed.length >= text.length };
}
