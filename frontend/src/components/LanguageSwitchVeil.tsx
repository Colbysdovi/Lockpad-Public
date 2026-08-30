import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "@/components/icons";
import { EASE_FOLLOW, LANGUAGE_VEIL_IN_MS, LANGUAGE_VEIL_OUT_MS } from "@/lib/motion";

// The veil that covers the app while the interface changes language.
//
// ── What this is, plainly ───────────────────────────────────────────────────
//
// Switching language is instant. The catalogue is already in the bundle, and React
// re-renders in a frame. This overlay exists to give that change a beat, so it reads
// as the app having done something rather than as a flicker somebody half-noticed.
// It makes the app slower on purpose, and the duration lives in lib/motion.ts where
// that decision can be tuned or reversed.
//
// ── Why the blur is on the app and not on this ──────────────────────────────
//
// The veil itself must stay sharp: a blurred spinner reads as a rendering fault. So
// the blur is applied to `.app-shell` by a class on <html> (see index.css), and this
// component is a SIBLING of the shell rather than a child of it — which is also why
// it is mounted in AppLanguageProvider, above everything the blur applies to.
//
// ── Reduced motion ──────────────────────────────────────────────────────────
//
// Someone who has asked their machine for less movement is not asking for a
// theatrical pause. With the setting on, the veil never mounts and the switch is
// instant, which is the honest behaviour underneath all of this anyway.

export function LanguageSwitchVeil({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="language-veil"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: LANGUAGE_VEIL_IN_MS / 1000, ease: EASE_FOLLOW } }}
          // The exit is what the whole effect is for: the veil lifting is the moment
          // the translated app is revealed, so it is slower than the arrival and the
          // spinner fades out with it rather than being cut.
          exit={{ opacity: 0, transition: { duration: LANGUAGE_VEIL_OUT_MS / 1000, ease: EASE_FOLLOW } }}
          // Nothing here is clickable, and that is the point: a full-viewport
          // element with ordinary pointer events swallows every click aimed at the
          // app underneath. That matters more than it looks. For the first fraction
          // of a second the interface below is still in the OLD language (see
          // LANGUAGE_SWAP_DELAY_MS), so the Settings control the reader just used is
          // sitting there live, unchanged, and about to relabel itself. A click that
          // got through would land on whatever ends up in that spot, which is not
          // what anybody chose. Do not add `pointer-events-none`.
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[color-mix(in_srgb,var(--canvas)_55%,transparent)]"
          // Silent to assistive tech. A screen-reader user is not looking at a blur,
          // and announcing a decorative pause would be noise — the language change
          // itself is announced by the document's `lang` attribute changing.
          aria-hidden="true"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, transition: { duration: LANGUAGE_VEIL_IN_MS / 1000, ease: EASE_FOLLOW } }}
            exit={{ scale: 0.94, opacity: 0, transition: { duration: LANGUAGE_VEIL_OUT_MS / 1000, ease: EASE_FOLLOW } }}
            className="surface-elevated flex h-14 w-14 items-center justify-center rounded-2xl border bg-card shadow-lg"
          >
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
