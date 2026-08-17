import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE_FOLLOW, LOCK_BLUR_MS, LOCK_REVEAL_MS, SPRING_ANSWER } from "@/lib/motion";
import { NoteCard } from "@/components/NoteCard";
import { Button } from "@/components/ui/button";
import { FolderSelect, TagMultiSelect } from "@/components/selectors";
import { useNotesList, useTags } from "@/lib/hooks";
import { FileText, CornerDownLeft, Loader2, AppWindow, HardDrive, Lock } from "@/components/icons";
import { beginLockFx } from "@/lib/noteFx";
import { useLoop, useTypewriter } from "./previewAnimations";
import type { NoteCard as NoteCardType } from "@/lib/types";
import { useIsMobile } from "@/lib/useIsMobile";

// The pane every onboarding step shows its example in.
//
// Two rules govern what goes inside.
//
// It must be the REAL component. Every preview renders the same note card, composer
// and settings row the app renders, on the app's own canvas, so the pane reads as a
// zoomed screenshot rather than an illustration. Lookalikes would be less work today
// and wrong by the second change, and a tour showing an interface that no longer
// exists teaches something that has to be unlearned.
//
// And it should DO the thing, not merely depict it. A still picture shows what a
// feature looks like; half of what is worth knowing is what it does. A locked note is
// a padlock and a grey box until you have watched one seal itself. So each pane runs
// a short loop — and where the product already owns an animation for the thing being
// described, the loop drives THAT animation rather than imitating it. The lock step
// calls `beginLockFx`, the same broadcast the real lock button fires, so what the
// tour shows stays correct even after someone changes how locking looks.
//
// ── inert lives here, once ─────────────────────────────────────────────────
//
// Every preview is real, interactive UI: cards that open notes, buttons that delete
// them, a composer that would create one. The dialog has no close button, so a live
// control in here is an unintended exit — or worse, a real mutation fired by someone
// who thought they were looking at a picture.
//
// So the guard belongs to the FRAME, not to any step. A step cannot forget it,
// because a step never sets it. It goes on the DOM node rather than through a prop so
// that whatever these components grow next year is neutralised without anyone
// touching this file: `inert` removes the whole subtree from pointer events, the tab
// order and the accessibility tree in one move.

/** Paging motion, shared by the preview and the copy so they travel together.
 *
 *  FOLLOW, travelling sideways: the eye tracks one step leaving and the next
 *  arriving. Direction is signed — forward slides out left and in from the right, and
 *  Back is the same thing mirrored, which is what makes going back feel like
 *  retracing rather than a different gesture that lands somewhere earlier. */
export const stepSlide = {
  enter: (d: number) => ({ x: d >= 0 ? 34 : -34, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d >= 0 ? -34 : 34, opacity: 0 }),
};
export const STEP_SLIDE_TRANSITION = { duration: 0.3, ease: EASE_FOLLOW };

export function PreviewFrame({
  children,
  stepKey,
  dir = 1,
  className = "",
}: {
  children: React.ReactNode;
  /** Changes when the step changes; drives the slide. */
  stepKey: React.Key;
  /** 1 forward, -1 backward. */
  dir?: number;
  className?: string;
}) {
  const hull = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // Written to the node directly. React 18's types have no `inert` (19 added it), and
  // every cast-based workaround compiles fine while letting the attribute silently go
  // missing — on the one guard whose absence turns a picture into a trapdoor.
  useEffect(() => {
    hull.current?.setAttribute("inert", "");
  });

  return (
    <div className="min-w-0 shrink-0">
      <div className="relative">
        <div
          ref={hull}
          aria-hidden="true"
          className={
            // A FIXED height, not a maximum. With a maximum the pane is as tall as
            // whatever it happens to hold, so the modal resizes under the cursor every
            // time you press Next and the buttons move while you are reaching for
            // them. Pinning it makes the frame a window of constant size that
            // different things are shown through, which is how a screenshot in a
            // manual behaves.
            //
            // 300 is measured rather than guessed: a note card puts its folder and tag
            // chips at the BOTTOM, and on the tallest card the tour realistically
            // shows those sit 243px down.
            // `preview-pane` is the hook for one CSS rule: a note preview is capped
            // shorter in here than on a real list card. See index.css — a card at its
            // full 8.5rem preview is 300px tall, which is the entire frame, so the
            // card it is showing you cannot be seen whole.
            "preview-pane pointer-events-none relative h-[300px] w-full min-w-0 select-none overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-canvas " +
            className
          }
        >
          {/* Each step's example is absolutely positioned so the outgoing and incoming
              ones can occupy the window at once while they cross. The frame itself
              never moves — it is a window, and what slides is what is shown through
              it.

              Centring lives on this wrapper rather than on the frame: making the frame
              the flex container let its content SHRINK, because flex items shrink by
              default, and two note cards collapsed on top of each other inside a box
              too short for them. `min-h-full` keeps this at least as tall as the
              window so short previews centre, while `safe center` makes anything
              taller fall back to top alignment — so a card crops from its title
              downwards instead of losing its title and chips to a symmetric crop. */}
          <AnimatePresence initial={false} custom={dir}>
            <motion.div
              key={stepKey}
              custom={dir}
              variants={reduceMotion ? undefined : stepSlide}
              initial={reduceMotion ? { opacity: 0 } : "enter"}
              animate={reduceMotion ? { opacity: 1 } : "center"}
              exit={reduceMotion ? { opacity: 0 } : "exit"}
              transition={STEP_SLIDE_TRANSITION}
              className="absolute inset-0 flex min-h-full flex-col overflow-hidden p-3 [justify-content:safe_center] [&>*]:shrink-0"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
        {/* Fades the cut edge into the pane so the crop reads as deliberate rather
            than as a card that failed to finish rendering. */}
        <div className="pointer-events-none absolute inset-x-px bottom-px h-10 rounded-b-xl bg-gradient-to-b from-transparent to-canvas" />
      </div>
    </div>
  );
}

/** `!h-auto` overrides the card's own `h-full`, which exists because NoteCard is
 *  built to fill a row the virtualizer has already measured. It resolved to `auto`
 *  here until the sliding layer became `absolute inset-0` and gave it a definite
 *  height, at which point a two-line note stretched to 434px of mostly empty card. */
const CARD_RESET = "[&>*]:!h-auto";

/** Roughly how much preview text a card should carry to show well in the pane. */
const PREVIEW_TARGET = 120;

/** Lower is better. Distance from the target length, with overshoot punished harder.
 *
 *  This used to be a plain shortest-first sort, and shortest-first has a failure mode
 *  that only shows up against a real library: the shortest note anybody owns is their
 *  most trivial one. The tour opened on "Ship it." and "Call the dentist" — two cards
 *  that between them say nothing about what the app is for, picked by a rule that was
 *  optimising for FITTING rather than for meaning.
 *
 *  Long notes still lose, and for a concrete reason: the pane clips what overflows,
 *  and a card puts its folder and tag chips at the BOTTOM, so an overlong note gets
 *  cropped through exactly the thing the tour is pointing at. But a one-liner now
 *  loses too. */
function previewScore(n: NoteCardType) {
  const len = n.preview?.trim().length ?? 0;
  return len > PREVIEW_TARGET ? (len - PREVIEW_TARGET) * 1.6 : PREVIEW_TARGET - len;
}

function useLibraryNotes(count: number, organised = false) {
  const { data, isLoading } = useNotesList({ filter: "active" });
  const notes = useMemo(() => {
    const all = data?.pages.flatMap((p) => p.notes) ?? [];
    const ranked = [...all].sort((a, b) => previewScore(a) - previewScore(b));
    if (!organised) return ranked.slice(0, count);
    // Two tags rather than one, because step 2 shows a folder and a row of tags and
    // the alternative to finding them is inventing them. See OrganisedCardsPreview.
    const wellFiled = ranked.filter((n) => n.folder && n.tags.length >= 2);
    const filed = wellFiled.length ? wellFiled : ranked.filter((n) => n.folder && n.tags.length > 0);
    return (filed.length ? filed : ranked).slice(0, count);
  }, [data, count, organised]);
  return { notes, isLoading };
}

/** A held space rather than a spinner. These notes were written moments ago by the
 *  seeding call, and a spinner on the first screen of a brand-new app reads as
 *  "something is wrong" far more than it reads as "one moment". */
const Placeholder = () => <div className="h-[124px] rounded-lg border border-dashed border-[color-mix(in_srgb,var(--border)_60%,transparent)]" />;

/** STEP 1 — the shape of the whole system, which is the thing the step is claiming.
 *
 *  Two boxes, one wire, and a boundary drawn around both. A dot travels down the wire
 *  and back, forever, and never leaves the boundary. That is the entire diagram, and
 *  it is the entire architecture: your browser talks to your server and to nothing
 *  else.
 *
 *  ── Why a diagram at all, when the research said otherwise ────────────────
 *
 *  `docs/forge/onboarding-step1-privacy-preview-research.md` surveyed Home Assistant,
 *  Mullvad, Apple, Tailscale and Synology and found that none of them draws this — they
 *  state the claim in copy and show the product. That finding still stands, and this is
 *  a deliberate decision to go the other way, taken with the trade named: step 1 gives
 *  up showing a note in exchange for showing the promise. Step 2 is where a real note
 *  card now appears for the first time.
 *
 *  ── What it deliberately is not ──────────────────────────────────────────
 *
 *  There is no cloud with a line through it and no shield. A crossed-out cloud draws
 *  attention to the thing being denied, and it asserts something a viewer cannot check.
 *  The absence here is structural instead: the third party is not struck out, it is
 *  simply not in the picture, because it is not in the system.
 *
 *  The motion is FOLLOW, travelling: the dot goes out on the request and back on the
 *  response, which is the same journey a real one makes. Under reduced motion it sits
 *  still on the wire, and the diagram reads exactly as well. */

/** Laid out ACROSS rather than down, because the pane is 526 wide and 276 tall.
 *
 *  Stacked vertically the diagram was a narrow column in a wide box, and the reading
 *  order ran the same way the text below it does, so the step asked to be read twice.
 *  Side by side it is a picture: two things, a distance between them, and something
 *  crossing it. The widths are fixed rather than fluid so the dot's travel is a known
 *  number instead of something measured at runtime — 140 + 12 + 124 + 12 + 140 = 428,
 *  which is exactly the boundary's inner width. 140 rather than 132 because at 132 the
 *  server's label wrapped to two lines and the two ends stopped being the same shape;
 *  the wire gives up what the labels need, since its length carries no meaning. */
const NODE_W = 140;
const WIRE_W = 124;

/** The same picture, sized for a phone.
 *
 *  Fixed at desktop numbers the boundary is 442px wide, against 325px of usable
 *  width inside the modal on a 375px screen — it overflowed by 117px and was clipped
 *  by 33px on EACH side, cutting the tiles in half. The wire gives up the most,
 *  because its length is the one measurement here that carries no meaning: it is a
 *  distance, and a shorter distance is still a distance. The tiles then give up what
 *  is still needed after that.
 *
 *  140 → 108 puts the server's label over two lines where the desktop one fits on
 *  one, which is exactly the asymmetry the desktop width was chosen to avoid — so
 *  the label block reserves two lines' height on phones regardless of what wraps
 *  (see DiagramNode). Both ends stay the same shape; one of them just has more to
 *  say. */
const NODE_W_SM = 108;
const WIRE_W_SM = 56;

/** The dot is 8px, so it stops that far short of the far end. */
const DOT_SIZE = 8;

/** The request's round trip, as four beats rather than one keyframe list.
 *
 *  One clock drives the dot AND both cards, so the moment a request lands and the
 *  moment the far end reacts to it cannot drift apart. That is the whole reason this
 *  is a phase machine instead of `x: [0, 134, 0]` looping on its own: a reaction that
 *  fires slightly before or after the arrival stops being a reaction. */
const TRAVEL_MS = 1250;
/** How long the dot rests at each end.
 *
 *  It was 460ms, which was enough for a card to twitch and not enough for anything to
 *  be watched. The arrival now carries a badge that has something to say — someone
 *  typing at one end, a lock closing at the other — and a badge that appears and
 *  leaves inside half a second is a flicker rather than a beat. Long enough to notice
 *  what it shows, short enough that the loop still comes round twice while the step's
 *  copy is being read. */
const LAND_MS = 2800;

export function ArchitecturePreview() {
  const reduceMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const nodeW = isMobile ? NODE_W_SM : NODE_W;
  const wireW = isMobile ? WIRE_W_SM : WIRE_W;
  const dotTravel = wireW - DOT_SIZE;
  //  0 out · 1 landed at the server · 2 back · 3 landed at the browser
  const phases = useMemo(() => [TRAVEL_MS, LAND_MS, TRAVEL_MS, LAND_MS], []);
  const phase = useLoop(phases, true);
  const travelling = phase === 0 || phase === 2;
  const atServer = !reduceMotion && phase === 1;
  const atBrowser = !reduceMotion && phase === 3;
  const dotAtServer = phase === 0 || phase === 1;

  return (
    <div className="flex h-[276px] w-full items-center justify-center">
      <div className="relative rounded-2xl border border-dashed border-border px-3 py-8 sm:px-5 sm:py-12">
        {/* Sat ON the border, in the app's own chip treatment, so it labels the
            boundary rather than floating near it. */}
        <span className="chip-scrim absolute -top-2 left-4 rounded px-1.5 py-0.5 text-[10px] font-medium text-[color-mix(in_srgb,var(--foreground)_70%,transparent)]">
          Your network
        </span>

        <div className="flex items-start gap-2 sm:gap-3">
          <DiagramNode
            width={nodeW}
            compact={isMobile}
            icon={AppWindow}
            title="This browser"
            sub="Where you write"
            active={atBrowser}
            badge="typing"
          />

          {/* The wire. Out, then back: a request and its answer.
              `mt-9` puts it on the tiles' centre line — the tile is 80 tall and the dot
              is 8, so 40 − 4. On phones the tile is 64, so it is 32 − 4 = mt-7. */}
          <div className="relative mt-7 h-2 sm:mt-9" style={{ width: wireW }}>
            <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
            <motion.span
              aria-hidden
              className="absolute left-0 top-0 h-2 w-2 rounded-full bg-primary"
              // No Tailwind transform on this element on purpose: framer owns the
              // transform while it animates `x`, and any `-translate-*` here would be
              // overwritten the moment the animation started.
              initial={{ x: 0 }}
              animate={{ x: reduceMotion ? dotTravel / 2 : dotAtServer ? dotTravel : 0 }}
              transition={{ duration: travelling && !reduceMotion ? TRAVEL_MS / 1000 : 0, ease: EASE_FOLLOW }}
            />
          </div>

          <DiagramNode
            width={nodeW}
            compact={isMobile}
            icon={HardDrive}
            title="Your server"
            sub="Where notes are kept"
            active={atServer}
            badge="locking"
          />
        </div>
      </div>
    </div>
  );
}

/** One end of the wire: a big icon in its own tile, with its label underneath.
 *
 *  The tile carries the app's card surface, so the picture is made of the same
 *  material as the interface it describes. Sizing it up and moving the text below it
 *  is what turns this pane from a labelled list into something you can take in without
 *  reading — which matters on the one step where the copy underneath is already saying
 *  the same thing in words.
 *
 *  `active` is true for as long as the dot is resting here, and it drives three things
 *  at once: the tile gives a small ANSWER spring, the icon plays its own animation, and
 *  a badge appears at the corner saying what is happening at this end. The icon
 *  animation is the icon system's own `animate` prop rather than anything written here,
 *  so these behave exactly like every other icon in the app does on hover, including
 *  going quiet under reduced motion without being asked. */
function DiagramNode({
  icon: Icon,
  title,
  sub,
  active,
  badge,
  width,
  compact,
}: {
  icon: typeof AppWindow;
  title: string;
  sub: string;
  active: boolean;
  badge: "typing" | "locking";
  width: number;
  compact: boolean;
}) {
  return (
    <div className="flex flex-col items-center text-center" style={{ width }}>
      {/* The badge is a sibling of the tile rather than a child, so the tile's
          arrival spring does not scale it as well. Two things springing by different
          amounts at the same moment reads as a wobble. */}
      <div className="relative">
        <motion.div
          animate={{ scale: active ? 1.06 : 1 }}
          transition={SPRING_ANSWER}
          className="flex h-16 w-16 items-center justify-center rounded-2xl border bg-card shadow-sm sm:h-20 sm:w-20"
        >
          <Icon className="h-7 w-7 text-muted-foreground sm:h-9 sm:w-9" animate={active} />
        </motion.div>
        <AnimatePresence>{active && <NodeBadge kind={badge} />}</AnimatePresence>
      </div>
      {/* mt-4 rather than mt-2.5: the tile is an 80px object and the label belongs to
          it rather than to the tile below, so the gap has to be visibly smaller than
          the space around the pair without being tight enough to look attached. */}
      <p className="mt-3 text-sm font-medium leading-tight sm:mt-4">{title}</p>
      {/* Two lines' worth of height is RESERVED on phones whether or not this wraps.
          At 108px "Where notes are kept" takes two lines and "Where you write" takes
          one, and two ends of a wire that are different heights read as one of them
          being broken. Reserving the space costs a few pixels and keeps the pair a
          pair. Desktop is wide enough that neither wraps, so it does not need it. */}
      <p
        className={
          "mt-0.5 text-xs leading-snug text-muted-foreground" + (compact ? " min-h-[2.25rem]" : "")
        }
      >
        {sub}
      </p>
    </div>
  );
}

/** The little pill that appears on a tile while the dot is resting there.
 *
 *  It exists because the two ends of this wire are doing different jobs, and the tiles
 *  alone cannot say which: a browser and a drive both just sit there. The badge is the
 *  verb. Someone is typing at one end; the note is being sealed at the other.
 *
 *  It is the INVERSE of the surface it sits on rather than a colour of its own:
 *  `--foreground` on `--canvas`, which is espresso-on-cream in light and cream-on-
 *  espresso in dark, so it stays firmly contrasted in both themes without a second
 *  rule. That is also why it is not terracotta any more. `--primary` is the app's call
 *  to action, spent on the button somebody is meant to press, and a pill that shouts
 *  as loudly as "Next" while doing nothing but narrating is spending attention it does
 *  not need. An inverted chip is the quietest thing that still reads as deliberate.
 *
 *  (The `--tooltip` tokens were the obvious alternative, being exactly "a small dark
 *  floating label". They are a fixed espresso in both themes, which lands at #3B2F27
 *  on a #322820 card in dark — near-invisible. Inverting beats borrowing here.)
 *
 *  Fixed width rather than padded to content, so the three dots and the padlock make
 *  the same shape. At `px-2` they came out 34px and 30px, and two badges that are
 *  nearly but not quite the same size read as a mistake rather than as a pair. */
function NodeBadge({ kind }: { kind: "typing" | "locking" }) {
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0, scale: 0.5, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.5, y: 4 }}
      transition={SPRING_ANSWER}
      className="absolute -bottom-2 -right-2 flex h-6 w-9 items-center justify-center gap-[3px] rounded-full bg-foreground text-canvas shadow-md"
    >
      {kind === "typing" ? <TypingDots /> : <LockingIcon />}
    </motion.span>
  );
}

/** Three dots, rising in sequence. The universal shorthand for someone at the other
 *  end of a conversation still writing, borrowed here for the person at this end. */
function TypingDots() {
  const reduceMotion = useReducedMotion();
  return (
    <>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1 w-1 rounded-full bg-current"
          animate={reduceMotion ? undefined : { y: [0, -2.5, 0], opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 0.9, ease: EASE_FOLLOW, repeat: Infinity, delay: i * 0.16 }}
        />
      ))}
    </>
  );
}

/** A padlock that CLOSES, on a loop, which is a different statement from a padlock
 *  that sits there being a padlock.
 *
 *  The motion lives in index.css (`.preview-lock-badge`) rather than here, and it does
 *  not use the icon system's `animate` prop, because the app's own lock animation is
 *  calibrated for a 20px glyph on a toolbar button: it moves the shackle 1.5px, which
 *  is invisible at 14px inside a 24px pill. The CSS drives the same part of the same
 *  glyph four times as far and repeats it, so a glance halfway through the dwell still
 *  catches it shutting. */
function LockingIcon() {
  return (
    <span className="preview-lock-badge flex items-center justify-center">
      <Lock className="h-3.5 w-3.5" />
    </span>
  );
}

/** How much of a note's preview the step-2 pane types out.
 *
 *  Long enough to look like real writing, short enough that the card still fits the
 *  window with its folder and tags underneath. */
const BODY_MAX = 78;

/** Cuts a preview where a person would stop, rather than at a fixed character count.
 *
 *  It was a plain `.slice(0, 78)`, and 78 characters lands wherever it lands. On the
 *  starter note it landed inside a word: the pane typed "…I can't say w" and then
 *  stopped, held that for three seconds, and looped. Nothing was broken and it looked
 *  entirely broken, which is the worst of both.
 *
 *  A finished sentence is the nicest place to stop, so one is used when it falls late
 *  enough to be worth typing at all. Otherwise the last word boundary, which at least
 *  leaves a whole word on screen. No ellipsis: the pane is imitating somebody typing,
 *  and nobody types the three dots that mean "there was more". */
function typableBody(preview: string) {
  const raw = preview.trim().replace(/\s+/g, " ");
  if (raw.length <= BODY_MAX) return raw;
  const window = raw.slice(0, BODY_MAX);
  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentence >= 44) return window.slice(0, sentence + 1);
  const space = window.lastIndexOf(" ");
  return space > 0 ? window.slice(0, space) : window;
}

/** STEP 2 — one note being organised, rather than several being shuffled.
 *
 *  The card stays put and its filing appears: the folder chip first, then three tags
 *  one at a time. Cycling between different notes showed variety; this shows the
 *  ACTION the step is describing, which is what someone will actually do.
 *
 *  The chips and the accent stripe are the card's own. The note handed to it simply
 *  grows a folder and then some tags between renders, so `useFolderAccent` picks the
 *  colour up and draws the stripe exactly as it does when you really file something —
 *  no imitation of the product's behaviour, just the product's behaviour. */
export function OrganisedCardsPreview() {
  const reduceMotion = useReducedMotion();
  const { notes, isLoading } = useLibraryNotes(20, true);

  // The note is shown with the tags it REALLY has, and no others.
  //
  // The first version topped the row up to three by borrowing tags from elsewhere in
  // the library, on the theory that the combination was still made of real things. It
  // is not defensible, and it showed: the note it picked was about keyboard shortcuts
  // and the borrowed tag was "travel". Nobody files a keyboard-shortcuts note under
  // travel, so the pane was demonstrating filing by filing something wrong — on the
  // one step whose entire job is to explain what tags are for.
  //
  // So `useLibraryNotes(…, true)` looks for a note that already carries a folder and
  // two or more tags, and whatever it finds is shown untouched. Two chips that make
  // sense teach the idea; three that do not actively work against it.
  const subject = useMemo(() => {
    if (!notes.length) return null;
    const base = notes.find((n) => n.folder && n.tags.length >= 2) ?? notes.find((n) => n.folder) ?? notes[0];
    return { ...base, tags: base.tags.slice(0, 3) };
  }, [notes]);

  // The note gets WRITTEN, then filed. Title, then body, then the folder, then the
  // tags one at a time.
  //
  // Filing appearing on a note that was simply there was the odd part: the step
  // begins mid-story, with the note already existing and only its labels arriving. A
  // person types something first. Showing that makes the folder and the tags read as
  // the second half of one action rather than as decoration landing on furniture.
  const title = subject?.title ?? "";
  const body = useMemo(() => typableBody(subject?.preview ?? ""), [subject]);
  const [w, setW] = useState({ title: 0, body: 0, filed: 0 });

  useEffect(() => {
    if (!subject) return;
    // The folder, then one beat per tag the note actually has. Fixed at four, the
    // loop spent a silent half-second "adding" a third tag to a note that only had
    // two.
    const fileSteps = 1 + subject.tags.length;
    if (reduceMotion) {
      setW({ title: title.length, body: body.length, filed: fileSteps });
      return;
    }
    let dead = false;
    const nap = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    (async () => {
      // Loops forever until the pane unmounts. `dead` is checked after every await
      // so a step change cannot leave a run typing into a component that is gone.
      for (;;) {
        setW({ title: 0, body: 0, filed: 0 });
        await nap(220);
        if (dead) return;
        for (let i = 1; i <= title.length; i++) {
          setW((x) => ({ ...x, title: i }));
          await nap(42);
          if (dead) return;
        }
        await nap(420);
        for (let i = 1; i <= body.length; i++) {
          setW((x) => ({ ...x, body: i }));
          await nap(22);
          if (dead) return;
        }
        await nap(620);
        for (let f = 1; f <= fileSteps; f++) {
          setW((x) => ({ ...x, filed: f }));
          await nap(f === 1 ? 700 : 520);
          if (dead) return;
        }
        await nap(3000);
        if (dead) return;
      }
    })();
    return () => {
      dead = true;
    };
  }, [subject, title, body, reduceMotion]);

  if (isLoading || !subject) return <Placeholder />;

  const typedBody = body.slice(0, w.body);
  const note: NoteCardType = {
    ...subject,
    title: title.slice(0, w.title),
    folder: w.filed >= 1 ? subject.folder : null,
    tags: subject.tags.slice(0, Math.max(0, Math.min(3, w.filed - 1))),
    // Rebuilt from the typed prefix so the card's own preview renderer draws it, one
    // character at a time, exactly as it draws any other note.
    previewDoc: typedBody
      ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: typedBody }] }] }
      : null,
  };

  return (
    // `layout` so the card GROWS as the text is typed rather than stepping.
    //
    // Each new wrapped line adds its height in a single frame, and across a title and
    // three lines of body that is four visible jolts, then one more when the loop
    // resets and the card snaps back to empty. Letting framer-motion interpolate the
    // box means the card swells under the words and settles back down, which is what
    // the eye expects of something being written into.
    <motion.div
      layout
      transition={{ duration: 0.22, ease: EASE_FOLLOW }}
      className={CARD_RESET + (reduceMotion ? "" : " preview-organising")}
    >
      <NoteCard note={note} filter="active" />
    </motion.div>
  );
}

/** STEP 3 — a note sealing itself, on a loop.
 *
 *  This drives the product's ACTUAL lock choreography rather than a copy of it.
 *  `beginLockFx` is the same broadcast the real lock button fires, and NoteCard
 *  answers it exactly as it does in the list: contents blurring away, padlock fading
 *  in where the text was. So what the tour shows is guaranteed to be what happens,
 *  including after somebody changes how locking looks.
 *
 *  The note is synthetic even though the component is not: a brand-new library has no
 *  locked note, and locking a starter note to manufacture one would leave something
 *  permanently unreadable in a library ten seconds old. */
export function LockedCardPreview() {
  const reduceMotion = useReducedMotion();

  // Four phases, and the two short ones are exactly the app's own lock durations.
  //
  //   0 readable   the contents are there to be taken away
  //   1 sealing    LOCK_BLUR_MS — the real blur, fired by beginLockFx
  //   2 locked     padlock, contents gone
  //   3 unlocking  LOCK_REVEAL_MS — the contents come back
  //
  // Matching the constants rather than picking round numbers is what removes the
  // stall this loop used to have: sealing ran for 950ms while the blur it was waiting
  // on finished at 420, so the card sat blurred-to-nothing for half a second and then
  // snapped into its locked state. The state now flips at the exact moment the blur
  // ends, which is the difference between a transition and two things happening near
  // each other.
  // A short opening beat on purpose. The first version held the readable state for
  // 2600ms, so somebody arriving on the step watched a still card for two and a half
  // seconds before anything happened, which is long enough to conclude that nothing
  // is going to. Long enough to read the note, short enough to feel like the pane was
  // waiting for you.
  const phase = useLoop([850, LOCK_BLUR_MS, 2400, LOCK_REVEAL_MS], true);

  useEffect(() => {
    if (reduceMotion || phase !== 1) return;
    beginLockFx("onboarding-locked-example");
  }, [phase, reduceMotion]);

  const note: NoteCardType = {
    id: "onboarding-locked-example",
    title: "Passport and insurance numbers",
    // Reduced motion skips the performance and shows the locked end state, which is
    // the fact the step is teaching.
    isLocked: reduceMotion ? true : phase === 2,
    color: null,
    folder: { id: "onboarding-folder", name: "Personal" },
    tags: [],
    preview: "Passport 4B92-118-27, travel policy TR-99041",
    previewBlocks: [],
    // Readable contents while unlocked, so the lock has something to take away. A
    // sealing animation over an already-empty card shows nothing at all.
    previewDoc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Passport 4B92-118-27, expires March 2031." }] },
        { type: "paragraph", content: [{ type: "text", text: "Travel policy TR-99041, claims line 0800 118 442." }] },
      ],
    },
    hasEncryptedContent: true,
    archivedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return (
    // `layout` animates the card's own height.
    //
    // This is the other half of the jump. Locking unmounts the preview block, so the
    // card loses about seventy pixels in a single frame — the contents had faded out
    // politely and then the box they were in vanished. In the real app that collapse
    // is hidden inside a list refresh nobody is staring at; here it is the only thing
    // on screen. Letting framer-motion animate the box means the card closes rather
    // than snaps shut.
    //
    // `preview-unlocking` covers the return trip: the app only ever animated the
    // padlock on unlock, so without it the text reappeared in one frame.
    <motion.div
      layout
      transition={{ duration: LOCK_REVEAL_MS / 1000, ease: EASE_FOLLOW }}
      className={
        CARD_RESET +
        (reduceMotion ? "" : phase === 1 ? " preview-sealing" : phase === 3 ? " preview-unlocking" : "")
      }
      style={{
        ["--lock-reveal-ms" as string]: `${LOCK_REVEAL_MS}ms`,
        ["--lock-blur-ms" as string]: `${LOCK_BLUR_MS}ms`,
      }}
    >
      <NoteCard note={note} filter="active" />
    </motion.div>
  );
}

/** STEP 4 — a file becoming notes.
 *
 *  A file drifts down into a drop target, lands, a bar fills while it is read, and
 *  then notes appear one at a time in a grid. It is the only pane here that is an
 *  ILLUSTRATION rather than a screenshot, and that is a deliberate exception: the
 *  others each point at a surface you will meet, whereas import is a PROCESS whose
 *  real interface is a file picker and a wait. A screenshot of a file picker teaches
 *  nothing. What someone actually wants to know is "my file goes in and my notes come
 *  out", and that is a sequence, not a screen.
 *
 *  The tiles are drawn rather than real note cards for the same reason a diagram is
 *  drawn: at four to a row inside a 300px window a real card renders as an
 *  illegible sliver, and legibility is the whole point of the beat. They borrow the
 *  app's own card surface, radius and border so the family resemblance holds.
 *
 *  Everything here is decorative and inside an `inert`, aria-hidden pane, so nothing
 *  is lost by a reader who never sees it — the step's copy carries the meaning. */
// What the imported notes say. Real-looking fragments of the kind of thing people
// actually keep in a notes app, so the grid reads as somebody's library arriving
// rather than as placeholder bars. Each carries a folder or a tag chip, because that
// is what makes a card recognisably a LOCKPAD card rather than a generic rectangle:
// the accent stripe down the left, the chips along the bottom.
//
// None of them is a reminder, for the same reason none of the starter notes is: this
// app has no due dates and nothing that brings a note back round. The first version
// of this grid was half errands — an MOT, a dentist appointment, order the tree — and
// sixteen of those arriving at once told a new user that Lockpad is where chores go,
// on the one screen showing them what a full library looks like.
const IMPORTED: { title: string; line: string; chip: string; accent: string }[] = [
  { title: "Recipes to try", line: "Miso butter pasta, the one from Ana", chip: "Kitchen", accent: "#fcd34d" },
  { title: "Standup notes", line: "Blocked on the auth migration", chip: "#work", accent: "#93c5fd" },
  { title: "Books", line: "Piranesi, then the Le Guin essays", chip: "Reading", accent: "#86efac" },
  { title: "On rewriting", line: "Cut the first paragraph. Always.", chip: "#writing", accent: "#fca5a5" },
  { title: "Gift ideas", line: "Dad: the good secateurs", chip: "Personal", accent: "#d8b4fe" },
  { title: "Guitar", line: "The bridge is a different song", chip: "#music", accent: "#fcd34d" },
  { title: "Overheard", line: "We're optimising the wrong thing", chip: "#quote", accent: "#fca5a5" },
  { title: "Berlin", line: "The canal walk beat every museum", chip: "Travel", accent: "#93c5fd" },
  { title: "Garden", line: "Tomatoes want six hours, not four", chip: "Home", accent: "#86efac" },
  { title: "Podcasts", line: "The one on why cities stopped building", chip: "#listen", accent: "#d8b4fe" },
  { title: "Sleep", line: "Reading in bed beat everything else tried", chip: "Health", accent: "#fca5a5" },
  { title: "Side project", line: "What if the archive were the default view?", chip: "#idea", accent: "#93c5fd" },
  { title: "Wine", line: "The Portuguese red, under a tenner", chip: "Kitchen", accent: "#fcd34d" },
  { title: "Running", line: "Second half of the canal route is easier", chip: "#health", accent: "#86efac" },
  { title: "On trust", line: "Anything I can't export, I don't own", chip: "#idea", accent: "#d8b4fe" },
  { title: "Winter list", line: "Long soups, longer books", chip: "Personal", accent: "#fca5a5" },
];
const IMPORT_TILES = IMPORTED.length; // four rows of four

export function ImportRowPreview() {
  const reduceMotion = useReducedMotion();

  // drift(900) · land(420) · read(1600) · the target withdraws(420) · then one tile at
  // a time · hold(2400) · clear(380)
  //
  // The read is close to two seconds and deliberately unhurried. A real export takes a
  // moment, and a progress that snaps to finished teaches the wrong expectation about
  // what happens when somebody drops their own file in.
  //
  // The two beats worth explaining are the ones that TAKE THINGS AWAY, because they
  // are what turns three simultaneous objects into a sequence:
  //
  //   · the dashed target leaves BEFORE the read ends, so the file has visibly been
  //     accepted — the thing that was asking for a file has stopped asking. Held to
  //     the end instead, it sat there empty while the notes arrived, still inviting a
  //     drop nobody was going to make.
  //   · the file card leaves AS the first notes appear, because it has become them.
  //     One object replacing another reads as a conversion; both on screen at once
  //     reads as two unrelated things.
  const phases = useMemo(
    // …and a final CLEARING beat, which exists because of what the loop looked like
    // without it. Wrapping straight from the hold back to the drag put the file in
    // the air while the previous cycle's sixteen notes were still fading out, so
    // every few seconds the pane showed a full library and an incoming file at once.
    // A short beat that empties the grid before the next file appears keeps the
    // sequence readable as a sequence.
    () => [900, 420, 1600, 420, ...Array<number>(IMPORT_TILES).fill(105), 2400, 380],
    [],
  );
  const phase = useLoop(phases, true);
  const clearing = phase === phases.length - 1;
  /** The phase the first tile lands on. Everything below counts from here, so
   *  retiming the opening beats cannot silently shift the grid. */
  const FIRST_TILE = 4;

  const dropped = !clearing && phase >= 1;
  // The spinner spans both read beats — it is still reading while the target leaves.
  const reading = phase === 2 || phase === 3;
  // The dashed target, and the file card, on separate switches so they can leave at
  // different moments.
  const targetShown = !reduceMotion && !clearing && phase <= 2;
  const fileShown = !reduceMotion && !clearing && phase < FIRST_TILE;
  const tiles = reduceMotion
    ? IMPORT_TILES
    : clearing
      ? 0
      : Math.max(0, Math.min(IMPORT_TILES, phase - (FIRST_TILE - 1)));

  return (
    // TWO LAYERS IN A FIXED BOX, not a column that grows.
    //
    // These are alternative contents of one window, so they are stacked and each is
    // centred in the whole box. Nothing here changes layout: the drop stage fades out
    // and the notes fade in, and the box is the same 268px throughout.
    //
    // It was a flex column with `justify-center`, and the two children animated their
    // heights — 104→0 as the file left, 0→auto as the grid opened, over 0.34s and
    // 0.3s. Centring a column means the block's top edge moves by half of every
    // height change, every frame, so two differently-timed animations pulling in
    // opposite directions made the whole thing shuffle and then settle, right at the
    // moment the first two tiles landed. Animating `height: "auto"` added its own
    // one-frame snap when framer swaps the measured pixel value for the literal
    // keyword at the end.
    //
    // None of that motion was carrying meaning. Fading is.
    <div className="relative h-[268px] w-full">
      <motion.div
        initial={false}
        animate={{ opacity: fileShown ? 1 : 0, scale: fileShown ? 1 : 0.98 }}
        transition={{ duration: 0.34, ease: EASE_FOLLOW }}
        className="absolute inset-0 flex items-center"
      >
        <div className="relative flex h-[104px] w-full items-center justify-center">
          {/* The dashed target is its own layer now, sitting BEHIND the file rather
              than containing it. As a wrapper it could only ever leave when the file
              left, and the whole point of this beat is that it goes first. */}
          <motion.div
            aria-hidden
            initial={false}
            animate={{ opacity: targetShown ? 1 : 0, scale: targetShown ? 1 : 0.97 }}
            transition={{ duration: 0.3, ease: EASE_FOLLOW }}
            className={
              "absolute inset-0 rounded-lg border-2 border-dashed transition-colors duration-200 " +
              (dropped ? "border-[color-mix(in_srgb,var(--accent-foreground)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "border-border")
            }
          />
          {/* Two keyframes while it is still in the air, so the file DRIFTS rather
              than hanging at an offset and then teleporting down. A single static
              position read as no drag at all. */}
          <motion.div
            initial={false}
            animate={
              reduceMotion
                ? { y: 0, scale: 1, rotate: 0, opacity: 1 }
                : clearing
                  ? // Held out of sight while the grid empties, so the two beats
                    // never share the pane.
                    { y: -30, opacity: 0, scale: 1, rotate: -2.5 }
                  : dropped
                    ? { y: 0, scale: 0.96, rotate: 0, opacity: 1 }
                    : { y: [-30, -12], scale: 1, rotate: [-2.5, 1.5], opacity: 1 }
            }
            transition={{ duration: dropped ? 0.44 : 0.9, ease: EASE_FOLLOW }}
            className="relative flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5 text-sm shadow-md"
          >
            {/* The file BECOMES the spinner once it lands, in the same chip.
                Reading is the state the drop target is in, so the target should be
                what says so. The separate bar underneath was a second thing to watch
                that told you nothing the chip could not, and it sat where the notes
                were about to arrive. */}
            <AnimatePresence initial={false} mode="wait">
              {reading ? (
                <motion.span
                  key="reading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: EASE_FOLLOW }}
                  className="flex items-center gap-2.5"
                >
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  {/* "Reading your notes" was the wrong sentence to put on this beat.
                      It is accurate about the software and wrong about the feeling:
                      the one moment somebody hands this app a file containing years of
                      their own writing is not the moment to use the verb a person uses
                      when they look through somebody else's things.

                      What is true instead is WHERE it happens. The file is posted to
                      the user's own backend and parsed there (routes/import.ts), so
                      naming the place turns the anxious beat into the reassuring one,
                      and it does it with a fact rather than a promise. */}
                  <span className="font-medium text-muted-foreground">Unpacking on your server…</span>
                </motion.span>
              ) : (
                <motion.span
                  key="file"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: EASE_FOLLOW }}
                  className="flex items-center gap-2.5"
                >
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Keep-export.json</span>
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>

      {/* The grid holds its full 258px from the start and simply has nothing visible
          in it. All sixteen tiles are always mounted so each can fade in on cue, and
          because the layer is absolute it costs the drop stage no room to do that —
          which is what lets both the reserved space and the earlier beats coexist.
          The tiles are the only thing that fades; the container never animates, so
          there is no frame where a row is arriving and the box is still resizing. */}
      <div className="pointer-events-none absolute inset-0 flex items-center">
        <div className="grid w-full grid-cols-4 gap-1.5">
          {IMPORTED.map((n, i) => (
            <motion.div
              key={n.title}
              initial={false}
              // Arriving and leaving are not the same move.
              //
              // Arriving, a tile grows the last fraction and rises into place: it is
              // one note among sixteen being made. Leaving, every tile goes at once
              // and only sinks and fades, at the size it already was. Scaling them
              // down on the way out made the grid look like it was being pulled back
              // through the pane rather than simply clearing, and sixteen simultaneous
              // shrinks are a lot of movement for a beat that exists to end things.
              // `scale` is pinned to 1 through the clear for exactly that reason.
              animate={{
                opacity: i < tiles ? 1 : 0,
                scale: clearing ? 1 : i < tiles ? 1 : 0.9,
                y: i < tiles ? 0 : 6,
              }}
              transition={{ duration: 0.28, ease: EASE_FOLLOW }}
              // A fixed 60px so four rows actually fit the window.
              //
              // Left to size themselves the tiles came out at 77px, which makes four
              // rows 327px inside a 268px column: the grid overflowed the frame top and
              // bottom and, because the frame clips, the whole thing rendered as an
              // empty pane. Four rows was the requirement, so the tile is what gives.
              className="relative h-[60px] overflow-hidden rounded-lg border bg-card py-1 pl-2 pr-1.5 shadow-sm"
            >
              {/* The accent stripe, which is the single most recognisable thing about a
                  Lockpad card. */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px] rounded-l-lg"
                style={{ background: n.accent }}
              />
              <p className="truncate text-[9px] font-semibold leading-tight">{n.title}</p>
              <p className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-muted-foreground">
                {n.line}
              </p>
              <span className="chip-scrim absolute bottom-1 left-2 inline-block rounded px-1 py-px text-[7px] text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]">
                {n.chip}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** STEP 5 — somebody actually using the composer.
 *
 *  A sentence gets typed, then a folder is chosen, then a couple of tags. It is the
 *  whole gesture of capturing a thought, not just the text box.
 *
 *  The pickers are the app's real `FolderSelect` and `TagMultiSelect`, driven by state
 *  this component owns. That is a departure from the rule the other panes follow, and
 *  it is worth being straight about why: `NoteBar` keeps its folder and tag choices in
 *  private state with no way in, and the only route to them from outside is to
 *  programmatically click the trigger and then an option. Those menus render in a
 *  portal at the document root, so they would escape the pane's clipping and float
 *  across the modal. Assembling the same bar from the same parts keeps every control
 *  genuine while leaving the sequence controllable.
 *
 *  Nothing here can create a note: there is no submit path wired at all. */
export function ComposerPreview() {
  const reduceMotion = useReducedMotion();
  const { notes } = useLibraryNotes(2);
  // A wider read purely to find filing that is actually in USE. Taking the first
  // folder the API returns picked "Archive 2024", an empty leftover, to file a note
  // about a leaking gutter. Folders and tags that real notes already carry read like
  // somebody's actual library, because they are.
  const { notes: sample } = useLibraryNotes(30);
  const { data: tagData } = useTags();
  const filing = useMemo(() => {
    // The FOLDER is chosen the same way the tags are, and for the same reason.
    //
    // It used to be `sample.find(n => n.folder)?.folder` — whichever folder turned up
    // first. Against the starter library that is "Writing", so a design idea got filed
    // under Writing: not absurd, just visibly not where a person would have put it.
    // The library now ships an "Ideas" folder too, and this picks it.
    const folders: { id: string; name: string }[] = [];
    for (const n of sample) {
      if (n.folder && !folders.some((f) => f.id === n.folder!.id)) folders.push(n.folder);
    }
    const FOLDER_IDEAL = ["ideas", "idea", "design", "product", "projects"];
    const FOLDER_WRONG = ["archive", "archive 2024", "personal", "health", "admin"];
    const folderRank = (f: { name: string }) => {
      const n = f.name.toLowerCase();
      if (FOLDER_IDEAL.includes(n)) return 0;
      if (FOLDER_WRONG.includes(n)) return 2;
      return 1;
    };
    const folder = [...folders].sort((a, b) => folderRank(a) - folderRank(b))[0] ?? null;

    // The tag list, read from the SAME query the selector reads.
    //
    // Order matters more here than it looks. TagMultiSelect renders its chips with
    // `tags.filter(t => value.includes(t.id))`, which follows the order `useTags()`
    // returns rather than the order the tags were added — so a tag that happens to
    // sit earlier in that list has its chip inserted to the LEFT of one already on
    // screen, and the row appears to rearrange itself instead of growing.
    //
    // The first attempt at this collected tags by walking the notes and hoping the
    // encounter order matched. It did, for the two tags it happened to pick, and
    // stopped matching the moment a different pair was chosen. Reading the same list
    // the selector reads is the only version of this that cannot drift.
    const all = tagData?.tags ?? [];

    // The sentence being typed is a design idea, so the tags beside it are ranked to
    // be the ones somebody files a design idea under. Left to take whatever came
    // first, this picked "#quote" for a sentence that is not a quote.
    //
    // Two tiers rather than one, because the sentence is specific now: the tags that
    // match it exactly go first, and the ones that merely live in the same corner of
    // a library are the fallback for somebody who has neither.
    //
    // Being straight about what this is: a hardcoded English preference list, which
    // will not generalise to another language and will fall through to whatever ranks
    // neutral against an unusual library. It is a nicety on a decorative pane rather
    // than a mechanism, and the honest alternative — showing the first two tags in the
    // library whatever they say — was worse in every case tried.
    const IDEAL = ["idea", "ideas", "design", "product", "ux"];
    const NEAR = ["thoughts", "writing", "reading", "notes"];
    const WRONG = ["todo", "errands", "reminder", "meeting", "recipe", "travel", "career", "q3-planning"];
    const rank = (t: { name: string }) => {
      const n = t.name.toLowerCase();
      if (IDEAL.includes(n)) return 0;
      if (NEAR.includes(n)) return 1;
      if (WRONG.includes(n)) return 3;
      return 2;
    };
    const chosen = [...all].sort((a, b) => rank(a) - rank(b)).slice(0, 2);
    // …then put them back into list order so the chips fill left to right.
    chosen.sort((a, b) => all.indexOf(a) - all.indexOf(b));
    return { folder, tags: chosen };
  }, [sample, tagData]);

  // A thought, not an errand — and specifically a thought the CHIPS make sense of.
  //
  // Two rewrites happened here. The first replaced "Ask the neighbour about the
  // leaking gutter", which is a reminder, and Lockpad has no due dates, no alerts and
  // nothing that brings a note back round, so the last step should not demonstrate
  // the one use it cannot support. The second is this one: the sentence has to be
  // filed under the tags that land beside it, and #design + #idea sitting under a
  // sentence about tools was two facts that did not add up. A design idea, filed as a
  // design idea, is one.
  const { typed, focused, done: finishedTyping } = useTypewriter(
    "What if search replaced the sidebar?",
    true,
    { charMs: 48, holdMs: 2600, gapMs: 900 },
  );

  // Folder lands a beat after the sentence, then the tags, the way somebody files a
  // thought once they have finished having it.
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    if (reduceMotion) {
      setPicked(3);
      return;
    }
    if (!finishedTyping) {
      setPicked(0);
      return;
    }
    const t1 = window.setTimeout(() => setPicked(1), 520);
    const t2 = window.setTimeout(() => setPicked(2), 1150);
    const t3 = window.setTimeout(() => setPicked(3), 1650);
    return () => [t1, t2, t3].forEach(window.clearTimeout);
  }, [finishedTyping, reduceMotion]);

  const folderId = picked >= 1 ? (filing.folder?.id ?? null) : null;
  const tagIds = filing.tags.slice(0, Math.max(0, picked - 1)).map((t) => t.id);
  // The bar opens on FOCUS, not on the first character.
  //
  // Tied to "has some text", the lift and the growth were two separate events 420ms
  // apart: the bar rose empty, then jumped taller the instant a letter appeared. One
  // gesture, arriving in two pieces. Opening on focus is also what the real composer
  // does — NoteBar's `expanded` is `!isMobile || focused || body.trim().length > 0`.
  const expanded = focused;
  const GROW = { duration: 0.28, ease: EASE_FOLLOW };

  return (
    // The clipping moved OFF this box and onto the notes behind.
    //
    // `overflow-hidden` here was cutting the composer's own shadow. The bar sits at
    // the bottom of the box, its focused shadow reaches about 46px below itself
    // (`0 30px 64px -16px`), and the box ended exactly where the bar did — so the
    // shadow was sliced off flat, which reads as the bar sitting on a shelf rather
    // than floating above a list. The notes are what actually need clipping, so they
    // get their own clipped layer and the bar is free to cast.
    <div className="relative h-[268px] w-full">
      <div className={"absolute inset-0 overflow-hidden " + CARD_RESET}>
        <div className="space-y-2">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} filter="active" />
          ))}
        </div>
      </div>
      {/* A beige wash over the notes while the composer is focused.
          //
          Being straight about what this is: the real app does NOT do this. NoteBar
          lifts and solidifies on focus and the list behind it carries on as normal, so
          this is the one place the pane shows something the product does not.
          It earns that because of the size difference. In the app the composer is a
          bar against a full window and its lift is unmissable; in a 300px pane at a
          glance, a 10px rise and a tint going from 72% to 92% card is a change you can
          miss entirely — and the whole step turns on noticing that the composer became
          active. The wash is a magnifying glass on a real state, not an invented one.
          Worth revisiting if the real composer ever grows a scrim of its own, so the
          two can share it. */}
      <motion.div
        aria-hidden
        initial={false}
        animate={{ opacity: focused ? 0.62 : 0 }}
        transition={{ duration: 0.28, ease: EASE_FOLLOW }}
        className="pointer-events-none absolute inset-0 bg-secondary"
      />

      {/* Floating over the notes and fading them out beneath it, the way the real
          composer sits above a list rather than after it.

          `pb-3` lifts the bar off the frame's own edge so there is somewhere for the
          shadow to land. It cannot have all 46px without spending the pane on empty
          space, but the tail of that shadow is nearly transparent by then, and the
          frame's bottom gradient fades what is left rather than cutting it. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-canvas via-canvas to-transparent pb-3 pt-10">
        {/* `is-focused` is the composer's OWN class, not a lookalike. The lift, the
            deeper shadow and the tint solidifying from 72% to 92% card all live in
            `.composer-bar.is-focused` in index.css, on the app's shared easing, so the
            pane performs the real focus transition rather than an approximation of it
            that would drift the first time somebody retunes the real one. Reduced
            motion is already handled there too: the tint still changes, the movement
            does not. */}
        {/* No `gap` on this column, and the second row is always mounted.

            A gap would hold 8px open while the row underneath is collapsed to
            nothing, and a row that mounts on demand cannot animate in — it simply
            exists at full height on the next frame, which is the jump. The row is
            always there and animates its own height instead, so the bar's box follows
            it frame by frame. Its spacing rides along inside it (`mt-2`) so it
            collapses with it.

            Height rather than framer's `layout`, deliberately: `layout` works by
            writing transforms, and this element already has one — `.is-focused`'s
            10px lift. Two owners for one transform is a fight, and the CSS would
            lose it silently. */}
        <div
          className={
            "surface-elevated composer-bar flex w-full flex-col p-2.5" +
            (focused ? " is-focused" : "")
          }
        >
          <div className="flex items-center gap-2">
            <div className="min-h-9 flex-1 px-1 py-1.5 text-sm">
              {typed || <span className="text-muted-foreground">Jot down an idea…</span>}
              {!reduceMotion && typed.length > 0 && !finishedTyping && (
                <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-[color-mix(in_srgb,var(--foreground)_70%,transparent)]" />
              )}
            </div>
            <motion.div
              initial={false}
              animate={{ width: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
              transition={GROW}
              className="overflow-hidden"
            >
              <Button size="sm" className="h-8 gap-1.5 whitespace-nowrap px-3">
                Create <CornerDownLeft className="h-3.5 w-3.5" />
              </Button>
            </motion.div>
          </div>
          <motion.div
            initial={false}
            animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
            transition={GROW}
            className="overflow-hidden"
          >
            {/* `layout` on the row, so the Tags button visibly slides aside as chips
                arrive rather than jumping to a new position. The chips themselves are
                the selector's own, and they carry `.chip-scrim`, which is what the
                `preview-organising` rule animates: each one fades and lifts in as it
                is added, the same entrance the note card's chips use two steps
                earlier. One rule, both places, so filing looks like filing wherever it
                happens. */}
            <motion.div
              layout
              transition={GROW}
              className={
                "mt-2 flex flex-wrap items-center gap-2 border-t pt-2" +
                (reduceMotion ? "" : " preview-organising")
              }
            >
              {/* Keyed on the folder so the trigger REMOUNTS when the choice changes,
                  which is what lets "No folder" cross-fade into the folder's name
                  instead of the label simply being different on the next frame.
                  Remounting is free here: the selector is inert and holds no state
                  worth keeping. */}
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={folderId ?? "none"}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: EASE_FOLLOW }}
                >
                  {/* No size override at all: FolderSelect's default is h-9/text-sm,
                      which is exactly what the tag chips and the Tags button next to it
                      are. The pane only ever renders at desktop width, and the real
                      NoteBar now asks for the same thing there. */}
                  <FolderSelect value={folderId} onChange={() => {}} />
                </motion.div>
              </AnimatePresence>
              <TagMultiSelect value={tagIds} onChange={() => {}} />
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
