import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_FOLLOW } from "@/lib/motion";
import { useT } from "@/lib/i18n";

// The first thing a brand-new library ever shows.
//
// ── Which curve, and why it isn't a new one ─────────────────────────────────
//
// FOLLOW. The vocabulary in lib/motion.ts defines it as "something is travelling or
// reshaping and the eye should track it — the default; if you are unsure, it is this
// one", and that is exactly what this is: a reveal the eye follows from nothing to
// the app's own mark. It is emphatically not ANSWER (nothing was pressed — there is
// no press to answer, this plays before the user has done anything at all) and not
// END (nothing is being destroyed). The same file warns that motion fitting none of
// the four "is worth a conversation, not a new constant", so this reuses FOLLOW at a
// longer duration rather than inventing a fifth curve for one screen a person sees
// once. Duration is the dial that carries ceremony here; the curve is not.
//
// ── Why it can't strand anyone ──────────────────────────────────────────────
//
// The wizard is behind this, and the wizard has no close button. So the one
// unacceptable outcome is an animation that fails to finish and leaves a new user
// looking at a padlock forever. `onDone` is therefore driven by a TIMER, not by an
// animation callback: framer-motion's onAnimationComplete does not fire if the
// element unmounts, if the tab is backgrounded mid-flight, or if a reduced-motion
// setting collapses the transition. The timer does not care about any of that.

// Longer than anything else in the app, on purpose.
//
// The old 2200ms put the tagline on screen for about 1.4 seconds — enough to notice
// something appeared, not enough to read it. A line nobody reads may as well not be
// written. At 3900 the mark settles, the name arrives, the rule draws, and the
// tagline sits there long enough to be finished before the modal takes over.
//
// This is the one screen in Lockpad allowed to take its time. It plays once per
// install; someone can replay the guide from Settings forever and never see this
// again, because a first launch is not a thing you get to have twice.
const BEAT_MS = 3900;
const REDUCED_MS = 500;

export function WelcomeAnimation({ onDone }: { onDone: () => void }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const [leaving, setLeaving] = useState(false);

  // The callback is held in a ref, and the timer effect below depends on NOTHING.
  //
  // That is not tidiness, it is the fix for a real bug this component shipped with
  // for about ten minutes: `onDone` is a fresh closure on every render, so listing it
  // as a dependency meant every re-render tore the effect down — clearing both
  // timers — and rebuilt it, where the once-only guard sent it straight back out
  // without re-arming them. The first `setLeaving(true)` therefore destroyed the very
  // timer that was supposed to fire 260ms later, and the animation sat on screen
  // forever, in front of a wizard with no close button. Exactly the outcome the
  // timer-instead-of-animation-callback decision was meant to rule out.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const total = reduceMotion ? REDUCED_MS : BEAT_MS;
    // Begin the fade slightly before handing over, so the modal's own entrance
    // starts as this clears rather than after it — two sequential animations with a
    // visible gap between them reads as a stall, not as choreography.
    const out = window.setTimeout(() => setLeaving(true), Math.max(0, total - 420));
    const hand = window.setTimeout(() => done.current(), total);
    return () => {
      window.clearTimeout(out);
      window.clearTimeout(hand);
    };
    // Deliberately empty: this must arm once, on mount, and survive every re-render
    // in between. See the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reduced motion gets a plain crossfade — not a shortened version of the full
  // sequence. A scaled-down version of a movement is still a movement, and the
  // setting is a request to not move things, not a request to move them briskly.
  if (reduceMotion) {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-canvas">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: leaving ? 0 : 1 }}
          transition={{ duration: 0.18, ease: EASE_FOLLOW }}
          className="flex flex-col items-center gap-4"
        >
          <img src="/favicon.svg" alt="" className="h-12 w-12" />
          <p className="type-section text-3xl">Lockpad</p>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      className="fixed inset-0 z-[60] grid place-items-center bg-canvas"
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.42, ease: EASE_FOLLOW }}
    >
      {/* The whole group drifts up a few pixels as it fades, so the hand-off to the
          modal reads as one continuous movement — the welcome rising away and the
          dialog rising in — rather than two animations taking turns. */}
      <motion.div
        className="flex flex-col items-center gap-4"
        animate={{ y: leaving ? -14 : 0 }}
        transition={{ duration: 0.42, ease: EASE_FOLLOW }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.86, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.95, ease: EASE_FOLLOW }}
          className="relative"
        >
          {/* A soft halo that blooms once behind the mark and settles. Cheap, and it
              gives the padlock a moment of arrival instead of simply being there. */}
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-full bg-[color-mix(in_srgb,var(--accent)_25%,transparent)] blur-2xl"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: [0, 1, 0.55], scale: [0.5, 2.6, 2.1] }}
            transition={{ duration: 1.9, ease: EASE_FOLLOW, times: [0, 0.45, 1] }}
          />
          {/* The app's own icon, not a stand-in glyph. This is the moment the app
              introduces itself, and it should introduce the mark someone will see on
              their home screen and in their browser tab from then on. */}
          <img src="/favicon.svg" alt="" className="h-14 w-14 sm:h-16 sm:w-16" />
        </motion.div>

        <motion.p
          className="type-section text-2xl sm:text-3xl"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE_FOLLOW, delay: 0.55 }}
        >
          Lockpad
        </motion.p>

        {/* No spacer at all now, and no rule. The name and the tagline sit on the
            column's own `gap-4`, which is what a tagline under a title should be.

            The history is worth two lines, because the number moved twice for
            reasons that stopped applying. A hairline used to live here carrying
            `my-4 sm:my-6`, and margins ADD to the column gap rather than collapsing
            into it, so the pair sat 65px apart. When the line went, the spacer
            inherited its measurements, which was wrong the moment there was nothing
            to give air to: a line needs room on both sides or it reads as a
            strikethrough, and type does not. What is left is one gap, and the two
            lines read as one lockup.

            The pause survives regardless — the tagline's delay is untouched, so it
            still arrives after a beat rather than with the name. */}

        <motion.p
          className="text-lg text-muted-foreground sm:text-xl"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, ease: EASE_FOLLOW, delay: 1.45 }}
        >
          {t("welcome.tagline")}
        </motion.p>
      </motion.div>
    </motion.div>
  );
}
