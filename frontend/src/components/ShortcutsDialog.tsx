import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUT_GROUPS, describeShortcut, keyLabel, type Shortcut } from "@/lib/shortcuts";
import { useT } from "@/lib/i18n";

// The keyboard shortcut reference.
//
// Desktop only, and the trigger that opens it is gated the same way (see Layout).
// A phone has no modifier keys to press, so a list of them is not "less useful"
// there — it is content about hardware the reader does not have. Nothing here
// needs a mobile treatment because nothing here should reach a phone.
//
// Everything shown comes from lib/shortcuts.ts, which reads its entries off the
// real bindings. This file is only the picture.

/** One key, drawn as a keycap.
 *
 *  A real <kbd> rather than a styled span: it is the element that means "key the
 *  user presses", and assistive tech and reader modes both act on that meaning.
 *
 *  Each key gets its own cap instead of one cap holding "⌘⇧S". Three small squares
 *  read as three things to press; one wide one reads as a word. The min-width is
 *  what keeps a single letter from collapsing into a cap narrower than it is tall,
 *  which is the detail that makes a row of these look like a keyboard rather than
 *  like inline code. */
function Keycap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-b-2 bg-background px-1.5 font-sans text-xs font-medium text-foreground">
      {label}
    </kbd>
  );
}

/** One row: what it does on the left, what to press on the right.
 *
 *  The whole combination is wrapped in a single element carrying an aria-label that
 *  SPELLS THE KEYS OUT, with the caps themselves hidden from the reader. Without
 *  that, a screen reader meets "⌘ ⇧ S" as three separate glyphs and announces
 *  something between three punctuation names and nothing at all. Sighted readers
 *  get the symbols; everyone else gets "Command plus Shift plus S".
 *
 *  `when` is appended as quiet text rather than dropped, because a shortcut that
 *  only works in one situation is a different fact from one that always works, and
 *  the situation is exactly what someone hunting a non-working key needs told. */
function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  const t = useT();
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="min-w-0 text-sm">
        {t(shortcut.action)}
        {shortcut.when && <span className="text-muted-foreground"> ({t(shortcut.when)})</span>}
      </span>
      <span
        className="flex shrink-0 items-center gap-1"
        aria-label={describeShortcut(shortcut.keys)}
        role="img"
      >
        {shortcut.keys.map((key, i) => (
          <Keycap key={i} label={keyLabel(key)} />
        ))}
      </span>
    </div>
  );
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Capped against the viewport and scrolling INSIDE, not growing past it. The
          list is a bounded set today and a growing one over time, and the failure
          mode of an uncapped dialog is that the newest entries are the ones that
          fall off the bottom of the screen. Radix handles Escape, the outside
          click, and returning focus to the trigger on close, which is the whole of
          the "dismiss and land back where I was" requirement — no reason to
          re-implement any of it here.

          `top-1/2` overrides the house anchor, and this is the one dialog that needs
          to. Dialogs normally sit slightly above centre (top-[42%]) so they land near
          eye level, which costs a short dialog nothing — but the nudge is measured
          from the viewport, not from the free space, so it eats a FIXED 8% of the
          screen regardless of how tall the panel is. At this panel's height that left
          26px above and 238px below: the reference read as pinned to the top edge
          while every other modal reads as centred. A panel this tall has no spare
          room to be nudged with, so it centres instead.

          The scroll lives on the list below rather than here, so the title and the
          close button stay put while the shortcuts move. Scrolling the whole panel
          carries the close button off the top of the screen, which is the one control
          someone reaching the bottom of a long list is most likely to want next.

          The explicit grid rows are load-bearing, not tidiness. The panel is a grid,
          and an `auto` row sizes to its content and then OVERFLOWS a capped container
          rather than compressing — so the list kept its full height, the extra was
          clipped by the cap, and the last few shortcuts simply vanished with nothing
          to scroll. Pinning the second row to `minmax(0, 1fr)` is what lets it give
          way, which is what hands the overflow to the list to scroll. */}
      <DialogContent className="top-1/2 grid-rows-[auto_minmax(0,1fr)] max-h-[80dvh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>
            {t("shortcuts.subtitle")}
          </DialogDescription>
        </DialogHeader>

        {/* min-h-0 is what actually lets this shrink: as a grid child its automatic
            minimum size is its content, so without it the list refuses to be smaller
            than its full height and pushes the panel past the cap instead of
            scrolling. gap-8 (not the old gap-5) because the two groups answer
            different questions — "anywhere" vs "while writing" — and at gap-5 the
            space between groups was barely wider than the space between rows, so the
            division was carried by the heading alone and the whole thing read as one
            long list. */}
        <div className="flex min-h-0 flex-col gap-8 overflow-y-auto pr-1">
          {SHORTCUT_GROUPS.map((group) => (
            /* The heading carries the distinction between the two groups, not a
               colour or a rule — so it survives being read by someone who cannot
               see the difference between them, and survives the page being printed. */
            <section key={group.title} aria-labelledby={`shortcuts-${group.title}`}>
              <h3
                id={`shortcuts-${group.title}`}
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t(group.title)}
              </h3>
              <p className="mb-1 mt-1 text-sm text-muted-foreground">{t(group.description)}</p>
              {/* divide-y rather than a gap: the rows are a table of pairs, and a
                  hairline between them keeps the eye on the correct right-hand
                  keycap when the action text is short and the row is wide. */}
              <div className="divide-y">
                {group.shortcuts.map((s) => (
                  <ShortcutRow key={`${s.action}-${s.keys.join("-")}`} shortcut={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
