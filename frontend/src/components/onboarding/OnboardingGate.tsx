import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_FOLLOW } from "@/lib/motion";
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
//
// ── Why this component OWNS the app rather than sitting beside it ───────────
//
// It used to be a sibling of the route table, which meant the app was mounted and
// painting underneath the whole first run. Nobody saw it during the welcome
// animation, because that is an opaque full-screen layer — but the animation fades
// out over 420ms before the wizard's own entrance finishes, and in that window the
// live app was plainly visible behind it. A brand-new user got a half-second look at
// a working interface, started to reach for it, and had a dialog land on top. The
// order read as an interruption rather than as a beginning.
//
// So first run now owns the screen outright: while it is running, `children` — the
// entire route table — is not mounted at all. What sits behind the wizard is the
// bare page canvas and its texture, which come from `body` in index.css and are
// therefore already there with nothing rendered on top. Then, and only then, the app
// arrives, fading up from that same canvas (see FirstRunReveal below).
//
// The cost of this is one extra beat before the app appears on EVERY cold load, not
// just the first: `children` is withheld while the onboarding query is in flight,
// because until it answers we do not know whether a first run is owed, and guessing
// "no" is exactly the flash described above. That beat is a same-origin GET on a
// connection the auth check has already opened, and what it shows in the meantime is
// the empty canvas — the same thing App's own auth-loading screen shows. It is a
// deliberate trade: a few milliseconds of nothing for everyone, in exchange for the
// one first impression never being ruined.

// The app fading up out of the canvas once the wizard is done.
//
// FOLLOW again, and slow — this is the same "nothing becoming something" reveal the
// welcome animation performs, played in reverse and handed over to the real
// interface. The HOLD is what makes it work: the app mounts under a still-opaque
// curtain and gets a beat to run its first queries and settle its layout before
// anything becomes visible, so what fades up is the finished screen rather than a
// loading state dissolving into a list.
const REVEAL_HOLD_MS = 260;
const REVEAL_MS = 1100;

/** An opaque canvas-coloured sheet over the newly-mounted app, which fades away.
 *
 *  Deliberately a curtain over the app rather than an opacity animation ON the app.
 *  Wrapping the route table in an animated element would put a new stacking context
 *  and a new layout box around every screen in Lockpad for the duration — and the
 *  layout here is full-height flex with a fixed sidebar, which is precisely the kind
 *  of thing that quietly breaks when an extra div appears in the middle of it. A
 *  sibling that fades out touches nothing. */
function FirstRunReveal({ onDone }: { onDone: () => void }) {
  const reduceMotion = useReducedMotion();

  // Same reasoning as the welcome animation's: driven by a timer, not by an
  // animation callback, so a backgrounded tab or a collapsed transition can never
  // leave a sheet of solid canvas sitting over the app forever.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const total = reduceMotion ? 0 : REVEAL_HOLD_MS + REVEAL_MS;
    const t = window.setTimeout(() => done.current(), total);
    return () => window.clearTimeout(t);
    // Arm once, on mount. See WelcomeAnimation for the bug that made this necessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A request not to animate is a request to simply be there, not to be there
  // sooner. No curtain at all in that case.
  if (reduceMotion) return null;

  return (
    <motion.div
      aria-hidden="true"
      // pointer-events-none from the first frame: the app underneath is real and
      // usable immediately, and a fading sheet must never swallow a click.
      className="pointer-events-none fixed inset-0 z-[55] bg-canvas"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: REVEAL_MS / 1000, delay: REVEAL_HOLD_MS / 1000, ease: EASE_FOLLOW }}
    />
  );
}

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useOnboardingState();
  const { seed, complete } = useOnboardingActions();
  const navigate = useNavigate();

  // Latched at the moment the decision is first made, and never re-read. Without
  // this, marking the instance complete would flip `data.onboarded` to true and tear
  // the modal out from under the closing animation — and worse, a replay from
  // Settings could never work, since the flag is true by then for everybody.
  const [phase, setPhase] = useState<"idle" | "animating" | "wizard" | "revealing">("idle");
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
    // Land on the full note list, whatever URL the browser happened to be pointed at.
    //
    // A first run does not necessarily start at "/" — a bookmark, a shared /notes/:id
    // link, or the dev replay from Settings all begin somewhere else, and the gate
    // never navigates on its own, so without this the guide hands over to whatever
    // page was underneath it. Someone who has just been told what folders and tags
    // are should be looking at their notes, not at the import screen.
    //
    // `replace`, so Back does not return to a page the user has never actually seen.
    // Batched with the phase change in one handler, so the app mounts already on the
    // home list rather than rendering the old route for a frame first.
    navigate("/", { replace: true });
    // Straight to "revealing", never through "idle" — the app has to come up under
    // the curtain, not appear bare for a frame and then be covered by one.
    setPhase("revealing");
    complete.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Not yet known whether a first run is owed. Show the canvas and nothing else;
  // see the note at the top of the file for why the app waits here too.
  if (isPending || !data) return null;

  if (phase === "animating") return <WelcomeAnimation onDone={() => setPhase("wizard")} />;

  if (phase === "wizard") {
    // Skip and finish are the same call on purpose. The flag answers "was this person
    // offered the tour", and both answers to that are yes.
    //
    // Note what is NOT rendered alongside it: `children`. The wizard sits on the bare
    // textured canvas, and the app does not exist until it closes.
    return <OnboardingModal open onBareCanvas onFinish={finish} onSkip={finish} />;
  }

  if (phase === "revealing") {
    return (
      <>
        {children}
        <FirstRunReveal onDone={() => setPhase("idle")} />
      </>
    );
  }

  // The ordinary case, and every load after the first: the app, unwrapped and
  // unanimated, with this component contributing nothing but a passthrough.
  return <>{children}</>;
}

/** The Settings replay. Re-shows the five steps against whatever library exists now.
 *
 *  Four things it deliberately does NOT do: re-seed (the starter notes are once per
 *  instance, and a Settings button that quietly adds notes would be a nasty
 *  surprise), re-arm first run, replay the welcome animation — that beat belongs
 *  to a genuine first launch, and playing it on demand would spend the one moment it
 *  was written for — or hide the app behind it. Someone replaying the guide is
 *  already using Lockpad and is looking at their own library; taking it away and
 *  fading it back in would be theatre, and would lose their scroll position. */
export function OnboardingReplay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <OnboardingModal open={open} onFinish={onClose} onSkip={onClose} />;
}
