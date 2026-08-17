import { useCallback, useEffect, useRef, useState } from "react";
import { useOnboardingState, useOnboardingActions } from "@/lib/onboarding";
import { WelcomeAnimation } from "./WelcomeAnimation";
import { OnboardingModal } from "./OnboardingModal";

// Decides whether a first run is happening, and runs it.
//
// ── What triggers this, and what deliberately does not ──────────────────────
//
// The server flag, and only the server flag. Never "are there zero notes", which is
// the tempting shortcut and is wrong in a way that takes months to show up: someone
// who clears out their library on a slow afternoon would be met with a welcome
// wizard for an app they have used for a year, and — far worse — three example notes
// they never asked for, written into the library they just deliberately emptied.
//
// ── The flicker rule ────────────────────────────────────────────────────────
//
// Nothing renders until the state query has actually resolved. Rendering optimistically
// and correcting afterwards would flash the welcome screen at every existing user on
// every cold load. `isPending` is doing real work below; it is not defensive noise.

export function OnboardingGate() {
  const { data, isPending } = useOnboardingState();
  const { seed, complete } = useOnboardingActions();

  // Latched at the moment the decision is first made, and never re-read. Without
  // this, marking the instance complete would flip `data.onboarded` to true and tear
  // the modal out from under the closing animation — and worse, a replay from
  // Settings could never work, since the flag is true by then for everybody.
  const [phase, setPhase] = useState<"idle" | "animating" | "wizard">("idle");
  const started = useRef(false);

  useEffect(() => {
    if (isPending || !data || started.current) return;
    if (data.onboarded) return;
    started.current = true;

    // Seeding fires HERE — at the start, not on completion — because §3.1 requires
    // the notes to exist whether or not the user reads a single step. Someone who
    // skips immediately should still land in a library with something in it.
    // Fire-and-forget is safe: the server call is idempotent, and the preview in
    // step 2 reads from the notes cache this invalidates on success.
    if (!data.seeded) seed.mutate();
    setPhase("animating");
    // seed is a stable mutation object from react-query; including it would re-run
    // this on every render without changing what it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isPending]);

  const finish = useCallback(() => {
    setPhase("idle");
    complete.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isPending || !data) return null;
  if (phase === "animating") return <WelcomeAnimation onDone={() => setPhase("wizard")} />;
  if (phase === "wizard") {
    // Skip and finish are the same call on purpose. The flag answers "was this person
    // offered the tour", and both answers to that are yes.
    return <OnboardingModal open onFinish={finish} onSkip={finish} />;
  }
  return null;
}

/** The Settings replay. Re-shows the five steps against whatever library exists now.
 *
 *  Three things it deliberately does NOT do: re-seed (the starter notes are once per
 *  instance, and a Settings button that quietly adds notes would be a nasty
 *  surprise), re-arm first run, or replay the welcome animation — that beat belongs
 *  to a genuine first launch, and playing it on demand would spend the one moment it
 *  was written for. */
export function OnboardingReplay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <OnboardingModal open={open} onFinish={onClose} onSkip={onClose} />;
}
