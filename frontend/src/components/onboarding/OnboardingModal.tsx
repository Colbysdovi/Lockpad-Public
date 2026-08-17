import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Folder, Hash, NotebookPen, ChevronRight, ShieldAlert } from "@/components/icons";
import {
  PreviewFrame,
  stepSlide,
  STEP_SLIDE_TRANSITION,
  ArchitecturePreview,
  OrganisedCardsPreview,
  LockedCardPreview,
  ImportRowPreview,
  ComposerPreview,
} from "./PreviewFrame";

// The five-step welcome.
//
// ── Show, don't describe ────────────────────────────────────────────────────
//
// Every step carries a preview pane holding the REAL component — the note card, the
// locked card, the Settings import row, the composer — on the app's own canvas, so
// each step reads as a zoomed screenshot of the product rather than a paragraph
// about it. Nobody learns an interface from prose. They learn it by recognising the
// thing when they meet it, which only works if what they were shown is what they
// will meet. See PreviewFrame for why these are never lookalikes.
//
// ── Three ways to move, two ways out ────────────────────────────────────────
//
// Back, Next and Skip. Back exists because a tour without one punishes curiosity:
// someone who clicks Next a beat too early has no way back to the sentence about
// passphrase recovery — the single most consequential sentence in the flow.
//
// There is still no × on this dialog, and that puts a real obligation on the code:
// Skip must work from every step or the flow is a trap. So Skip and Back live in the
// footer that every step shares, wired once, structurally impossible to omit from
// step four because somebody forgot. Escape maps to Skip rather than to a silent
// dismissal — Radix would otherwise close the dialog while the server still believed
// onboarding was owed, and the wizard would simply reappear on the next load.
//
// ── Honesty, in one place ───────────────────────────────────────────────────
//
// Step 3 says something unflattering while the user is still paying attention:
// locking has no passphrase recovery. It is true, it is better learned here than
// discovered later, and softening it would make this a sales pitch rather than an
// orientation. It is also the only sentence in the flow that stops being useful the
// moment somebody locks their first note, which is why it gets a warning box.
//
// Step 4 used to carry a second caveat, that import is tested far more against
// Google Keep than against anything else. That caveat now lives in Settings, on the
// import row itself, where it is read at the moment it can change what somebody
// does. Repeating it here bought nothing and cost the step its shape.

interface StepDef {
  title: string;
  body: React.ReactNode;
  preview: React.ReactNode;
  cta: string;
}

function Bullet({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

export function OnboardingModal({
  open,
  onFinish,
  onSkip,
}: {
  open: boolean;
  /** Completed the last step. */
  onFinish: () => void;
  /** Left early. Marks the instance onboarded exactly as finishing does — the flag
   *  records that the tour was offered, not that it was enjoyed. */
  onSkip: () => void;
}) {
  // The step and the DIRECTION it was reached from, kept together so a single state
  // update can never leave them disagreeing — which would show a step arriving from
  // the wrong side, the one artefact that makes paging feel broken rather than
  // merely animated.
  const [[step, dir], setStep] = useState<[number, number]>([0, 1]);
  const reduceMotion = useReducedMotion();
  const goTo = (next: number) => setStep([next, next > step ? 1 : -1]);

  // Rewind whenever the flow opens.
  //
  // Radix unmounts the dialog's CONTENT when `open` goes false, but this component
  // stays mounted — so `step` survives, and the Settings replay would resume on
  // whichever step you last skipped from. Someone who bailed on step four would
  // reopen "the welcome guide" and be shown the import caveat with no idea what
  // preceded it. Reopening a tour has to mean starting it.
  useEffect(() => {
    if (open) setStep([0, 1]);
  }, [open]);

  const steps: StepDef[] = [
    {
      title: "Welcome to Lockpad",
      cta: "Next",
      preview: <ArchitecturePreview />,
      body: (
        <p>
          Lockpad runs on your own server. You never made an account and nothing passes through a
          company in the middle, so what you write stays on the machine you installed it on. Give
          it two minutes and you'll know your way around.
        </p>
      ),
    },
    {
      title: "Notes, folders, and tags",
      cta: "Next",
      preview: <OrganisedCardsPreview />,
      body: (
        <ul className="space-y-2.5">
          <Bullet icon={<NotebookPen className="h-4 w-4" />}>
            <strong>Notes</strong> are where everything goes. Write, paste, tick things off, drop
            in some code.
          </Bullet>
          <Bullet icon={<Folder className="h-4 w-4" />}>
            <strong>Folders</strong> hold notes that belong together. Each note lives in one.
          </Bullet>
          <Bullet icon={<Hash className="h-4 w-4" />}>
            <strong>Tags</strong> cut across folders, so a note filed in one place still turns up
            everywhere else it belongs.
          </Bullet>
        </ul>
      ),
    },
    {
      title: "Lock what's sensitive",
      cta: "Next",
      preview: <LockedCardPreview />,
      body: (
        <div className="space-y-3">
          <p>
            Any note can be locked with its own passphrase. It gets encrypted in your browser
            before it's saved, so the server only ever holds scrambled text.
          </p>
          {/* Styled as a warning rather than as another paragraph. This is the one
              sentence in the flow with a consequence attached: everything else here
              can be forgotten and rediscovered later, whereas this one is only useful
              BEFORE somebody locks their first note. Set in the same grey as the rest,
              it read as another line of prose and got skimmed.

              Orange, not red. Red is the app's destructive colour and it means
              something specific — this will delete, this is broken, act now. Nothing
              is wrong here and nothing needs doing: a person reading this has not
              locked anything yet, and the sentence is describing how the feature
              works. Red would be borrowing alarm the situation has not earned, and an
              app that shouts at you on a welcome screen has spent a signal it will
              want later. SecuritySettings keeps its red for the exposure warning,
              which really is a misconfiguration.

              Only the icon carries the colour, and the box stays on the card's own
              background. A tinted panel was tried and it was wrong here: the tint is
              warm, the card is cream and the preview above it is warm too, so the
              callout stopped being a distinct object and became one more beige band
              in a beige column. On a plain white card a single orange mark is the
              loudest thing on the step, which is the whole job.

              This is the first use of `--warning` anywhere in the app. The token had
              been sitting in the palette since the colour system was built with
              nothing pointed at it, which is how it got away with being an ochre gold
              that reads as furniture next to a beige border; see index.css for the
              retune. */}
          <div
            role="note"
            className="flex gap-3 rounded-xl border bg-card p-3"
          >
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm">
              <strong>A forgotten passphrase cannot be recovered.</strong> Nobody can reset it and
              there is no back door, which is the whole point of encrypting it. Do not lose your
              passphrase.
            </p>
          </div>
        </div>
      ),
    },
    {
      title: "Bring your notes with you",
      cta: "Next",
      preview: <ImportRowPreview />,
      body: (
        <div className="space-y-3">
          <p>
            You don't have to start over. Bring the notes you already have and carry on from where
            you left off, with your folders and tags intact.
          </p>
          <p>
            Lockpad reads CSV, JSON, HTML, Markdown and plain text, plus Google Keep's JSON export.
            The importer is waiting in <strong>Settings</strong> whenever you're ready.
          </p>
        </div>
      ),
    },
    {
      title: "Happy note-taking",
      cta: "Get started",
      preview: <ComposerPreview />,
      body: (
        <p>
          The bar at the bottom of your list is where every note starts. Write down whatever is on
          your mind right now, however half-formed, and press enter. The rest of Lockpad you'll
          pick up as you go. You can reopen this guide from <strong>Settings</strong> whenever you
          like.
        </p>
      ),
    },
  ];

  const current = steps[step];
  const last = step === steps.length - 1;
  const first = step === 0;

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        mobileSheet
        // A FIXED size, so the modal never resizes between steps.
        //
        // Step bodies are not the same length — three bullet points, then two
        // paragraphs and a warning box — so a modal sized to its content grows and
        // shrinks as you page through it, and Next slides out from under the cursor
        // that is heading for it. Pinning the box means only its CONTENTS change,
        // which is what makes paging feel like turning a page instead of watching a
        // panel rebuild itself.
        //
        // Capped against the viewport as well as fixed, because a laptop in landscape
        // can be shorter than 640px, and a footer pushed below the fold in a dialog
        // with no close button is the trap this flow spends most of its code
        // avoiding. Mobile takes the same treatment as a bottom sheet.
        animClassName="onboarding-anim"
        className="flex h-[86dvh] max-w-xl flex-col overflow-hidden sm:h-[min(640px,88dvh)]"
        // Every escape hatch Radix offers is routed to skip rather than to a bare
        // close, so the flag is always written. A dialog that vanishes without
        // recording anything simply comes back next launch.
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          onSkip();
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
          {/* The example comes FIRST, above the title. The step is showing you a
              piece of the product and then telling you what you are looking at, and
              that order matters: a picture read before its caption gets looked at,
              whereas one placed under three lines of prose gets scrolled past. */}
          <PreviewFrame stepKey={step} dir={dir}>
            {current.preview}
          </PreviewFrame>

          {/* Radix needs exactly one title and one description for the dialog's
              accessible name, and the animated copy below renders two of everything
              while a step is crossing. So the real ones live here, hidden, outside
              the animation — and the visible heading is an ordinary element. */}
          <DialogTitle className="sr-only">{current.title}</DialogTitle>
          <DialogDescription className="sr-only">
            Step {step + 1} of {steps.length}
          </DialogDescription>

          {/* The one part allowed to vary, so it absorbs the difference between a
              three-bullet step and a two-paragraph one. `min-h-0` is what actually
              permits a flex child to scroll rather than push its siblings out of the
              box. Everything above and below it is a fixed height, which is why the
              footer sits in exactly the same place on all five steps.

              `mt-1` on top of the column gap: the example needs to read as its own
              object rather than as something the heading is sitting on. */}
          <div className="relative mt-3 min-h-0 min-w-0 flex-1">
            <AnimatePresence initial={false} custom={dir}>
              <motion.div
                key={step}
                custom={dir}
                variants={reduceMotion ? undefined : stepSlide}
                initial={reduceMotion ? { opacity: 0 } : "enter"}
                animate={reduceMotion ? { opacity: 1 } : "center"}
                exit={reduceMotion ? { opacity: 0 } : "exit"}
                transition={STEP_SLIDE_TRANSITION}
                className="absolute inset-0 overflow-y-auto text-sm leading-relaxed"
              >
                <h2 className="type-section mb-4 text-2xl sm:text-[1.75rem]" aria-hidden="true">
                  {current.title}
                </h2>
                {current.body}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* One footer for all five steps. Neither Skip nor Back can go missing from
              a step, because no step owns them. */}
          {/* Three zones, and the stepper is the middle one — centred in the footer
              rather than tucked beside Back. It describes the whole flow, not the
              back half of it, so it belongs where it reads as a progress bar for the
              modal instead of an ornament attached to a button.

              The side zones are `flex-1` and equal, which is what actually keeps the
              dots centred: Back appears and disappears between steps, and with a
              content-sized left zone the stepper would drift sideways every time it
              did. */}
          {/* On phones the stepper moves to its OWN row above the buttons, rather
              than being dropped. It was hidden here because Back, Skip and "Get
              started" already fill 375px and the dots ended up touching the Skip
              label — but the fix for "no room on this line" is another line, not
              leaving phone users with no idea how long the tour is. Five steps with
              no visible end is the kind of thing people quit rather than finish, and
              it is the phone where a tour is most likely to be abandoned. */}
          <div className="mt-auto flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex justify-center sm:hidden">
              <Stepper count={steps.length} current={step} />
            </div>
            {/* `w-full` matters: on desktop the mobile stepper above is display:none,
                so this is the flex-row's only child and would otherwise shrink to its
                own content instead of spanning the footer — which is what keeps Back
                left, dots centred and Skip/Next right. */}
            <div className="flex w-full items-center gap-3">
              <div className="flex flex-1 justify-start">
              <AnimatePresence initial={false}>
                {!first && (
                  <motion.div
                    key="back"
                    initial={reduceMotion ? { opacity: 0 } : { width: 0, opacity: 0 }}
                    animate={reduceMotion ? { opacity: 1 } : { width: "auto", opacity: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { width: 0, opacity: 0 }}
                    transition={STEP_SLIDE_TRANSITION}
                    className="overflow-hidden"
                  >
                    <Button variant="ghost" onClick={() => goTo(step - 1)} className="gap-1">
                      <ChevronRight className="h-4 w-4 rotate-180" /> Back
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

              {/* On desktop it stays on the button line, between the two side zones. */}
              <div className="hidden shrink-0 sm:block">
                <Stepper count={steps.length} current={step} />
              </div>

              <div className="flex flex-1 items-center justify-end gap-2">
                <Button variant="ghost" onClick={onSkip}>
                  Skip
                </Button>
                <Button onClick={() => (last ? onFinish() : goTo(step + 1))}>{current.cta}</Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The step dots.
 *
 *  One component for both placements — on the button row on desktop, on its own row
 *  above it on phones — so the two can never drift into being two different steppers.
 *
 *  aria-hidden because it is a picture of something already said properly: the
 *  dialog's description reads "Step N of M" to a screen reader on every step, which
 *  is the accessible version of this and does not depend on seeing a widened dot.
 */
function Stepper({ count, current }: { count: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={
            "h-1.5 rounded-full transition-all duration-200 " +
            (i === current ? "w-5 bg-foreground" : "w-1.5 bg-border")
          }
        />
      ))}
    </div>
  );
}
