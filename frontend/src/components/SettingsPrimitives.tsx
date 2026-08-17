import type { ComponentType, ReactNode } from "react";
import { TriangleAlert, type AnimatedIconProps } from "@/components/icons";
import { cn } from "@/lib/utils";

// The two shapes the Settings page is built out of: a section, and a row inside it.
//
// They live in their own file rather than in SettingsPage.tsx because the page is
// not the only thing that draws them — SecuritySettings and AboutSettings render
// their own sections, and they are imported BY the page. Keeping the primitives in
// the page would mean those files importing their parent, which is a cycle: it
// happens to work under ESM most of the time and fails confusingly when it doesn't.
// A shared leaf module has no such problem.
//
// ── The one rule this page is organised around ──────────────────────────────
//
// Every item here used to be the same bordered card with a button on the right: a
// version number, an import, and a permanent deletion with no trash to fall back
// on all looked identical. Nothing said "read this" as opposed to "click this",
// and nothing said "this one cannot be undone".
//
// So shape now carries meaning, consistently:
//
//   bordered card + button   something you DO
//   plain text, no border    something you READ
//   tinted card + red label  something you CANNOT UNDO
//
// The value of that is entirely in the consistency. A single informational block
// left in a bordered card, or one action written as plain text, and the reader is
// back to reading every description to find out which is which.

// Whatever `@/components/icons` exports — these are forwardRef components with
// their own prop type, so a hand-rolled `ComponentType<SVGProps>` does not accept
// them (their `strokeWidth` is a number, SVGProps allows a string).
type IconComponent = ComponentType<AnimatedIconProps>;

/** A titled group of rows.
 *
 *  The description is not decoration: it is the line that lets someone skip a
 *  whole section without reading the two or three cards inside it, which is the
 *  entire point of grouping them in the first place.
 *
 *  `tone="danger"` colours the heading and gives it a warning glyph. The glyph
 *  matters more than the colour — a red heading alone would say nothing at all to
 *  someone who cannot see the red, and the deletions underneath it are permanent.
 */
export function SettingsSection({
  id,
  title,
  description,
  tone = "default",
  className,
  children,
}: {
  id: string;
  title: string;
  description: string;
  tone?: "default" | "danger";
  className?: string;
  children: ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <section aria-labelledby={id} className={className}>
      <h2
        id={id}
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
          danger ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {danger && <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {title}
      </h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

/** One row: a title, an explanation, and its control.
 *
 *  Top-aligned, not centred. Cards in a row are stretched to match the tallest
 *  one, so centring meant a two-line card's title floated down the middle while
 *  its four-line neighbour started at the top — the eye had to find the title
 *  again for every card instead of reading down one line. `items-start` puts
 *  every title, and every button, on the same line across the whole grid.
 *
 *  `icon` gives the row a shape as well as a name, so the left column can be
 *  scanned rather than read. It is deliberately the SAME glyph the row's button
 *  carries — a second, cleverer icon for the same idea would mean learning two
 *  symbols for one thing.
 *
 *  `tone="danger"` reddens the title icon, and nothing else about the card. The
 *  card itself stays white.
 *
 *  It used to tint the whole card, and that was the wrong instrument: a card
 *  washed in red shouts before the reader knows what it is about, and shouts at
 *  the title and the description as loudly as at anything that matters.
 *
 *  The buttons are not red either, and that is the more interesting restraint.
 *  These rows open a dialog that lists what would be deleted and asks again —
 *  the delete lives THERE, not on this page. Reddening a button that only opens
 *  a review would spend the alarm on the safe step, and leave nothing louder in
 *  reserve for the step that is not safe.
 *
 *  So what is left is a red icon here and a red "Danger zone" heading with a
 *  warning glyph above, which marks the group without pretending the group is
 *  the danger. The confirmation dialog is the brake; this is only the sign.
 */
export function DataRow({
  title,
  description,
  icon: Icon,
  tone = "default",
  children,
}: {
  title: string;
  description: string;
  icon?: IconComponent;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium">
          {Icon && (
            <Icon
              className={cn("h-4 w-4 shrink-0", danger ? "text-destructive" : "text-muted-foreground")}
              aria-hidden="true"
            />
          )}
          {title}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Something to read, not to click.
 *
 *  No border, no card background, no button — because on this page a bordered card
 *  now means "there is an action here", and a status display that borrows that
 *  shape spends the reader's attention on a thing they cannot act on.
 *
 *  No leading icon either, and no padding. Having neither is what lets it sit on
 *  the same left edge as the section heading and description directly above it,
 *  which is the only alignment available to a block that has no card to sit in.
 */
export function InfoBlock({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
