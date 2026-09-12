import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Archive, Trash2, FolderInput, X, Folder as FolderIcon, Hash } from "@/components/icons";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useBulkAction, useQuietBulkAction, useFolders, useTags, useInvalidateNotes } from "@/lib/hooks";
import { beginBulkExit } from "@/lib/noteFx";
import { exitDurationMs, DELETE_BULK_STAGGER_CAP, EASE_FOLLOW, EASE_FOLLOW_REVERSED, BAR_SWAP_OUT_MS, BAR_SWAP_IN_MS, BAR_SWAP_TRAIL_MS, BAR_SWAP_OFFSCREEN } from "@/lib/motion";
import { flattenFolders } from "./selectors";
import { useSelection } from "@/lib/useSelection";
import { useToast } from "@/lib/useToast";
import { useT } from "@/lib/i18n";

// What to do with several notes at once.
//
// Tick two or more cards and this bar takes over the composer's slot at the bottom
// of the screen — the same position, so the thing you act with is always in the
// same place, and the composer comes back the moment the selection is empty. It
// deliberately does NOT appear at one selected note: a single note already has its
// own action bar on the card, and swapping the composer out for one tick would be
// more disruptive than useful.
//
// Everything goes through POST /notes/bulk, which applies the whole batch inside one
// database transaction — so a bulk archive of forty notes either happens completely
// or not at all, and never leaves half the selection in a different state.
//
// The two destructive actions (archive, delete) offer Undo through a toast, and both
// are SOFT: the notes keep their row, their folder and their tags, and restoring
// puts them back untouched. `reverse` on the toast makes the Undo replay each card's
// exit animation backwards, so the rewind is legible rather than a sudden reappearance.
//
// ── The selection SURVIVES a change, and why that is not uniform ────────────
//
// It used to be cleared after every action, on the reasoning that acting on a batch
// means you are done with it. In practice that made the common case painful: filing
// thirty notes into a folder AND tagging them meant selecting all thirty, moving
// them, then selecting all thirty again. The selection is the expensive thing the
// user built; an action should spend it, not destroy it.
//
// So move and tag now leave the selection alone. Apply as many as you like; the bar
// stays until you dismiss it with Deselect, which is the only control that ends a
// selection now.
//
// Archive and delete still clear it, and that is a real distinction rather than an
// inconsistency: those two REMOVE THE NOTES FROM THE LIST. Keeping thirty
// now-archived notes ticked would leave the bar reporting a selection with nothing
// on screen behind it, and the next button press would tag or move notes the user
// can no longer see — with an Undo toast still offering to bring them back, to a
// state that has since been edited underneath it. Emptying the list is the end of
// the batch whether or not the user says so.
//
// One consequence worth knowing: moving notes out of the folder you are looking at
// also takes them off screen, and there the selection DOES survive. That is
// deliberate — "file these, then tag them" is exactly the sequence this change
// exists for — but it means the count can outlive the cards. Deselect ends it.
// The five action buttons, trimmed narrower than a Button is by default.
//
// `size="default"` pays px-5 on a phone and px-4 on a pointer device, which is right
// for a button standing on its own and wasteful for five of them side by side in a
// bar that is already at its width limit. px-3 buys back 40px across the row.
//
// The `sm:` copy is not redundant. The variant spells its desktop padding `sm:px-4`,
// and an unprefixed utility cannot override a prefixed one at widths above the
// breakpoint no matter how late it merges — so a bare `px-3` would silently apply on
// phones only, which is the one place it was not needed.
const ACTION_BTN = "gap-1.5 px-3 sm:px-3";

export function BulkActionBar() {
  const t = useT();
  const { selectedIds, count, clear } = useSelection();
  const bulk = useBulkAction();
  const quietBulk = useQuietBulkAction();
  const invalidate = useInvalidateNotes();
  const reduceMotion = useReducedMotion();
  const toast = useToast();
  const folders = useFolders();
  const tags = useTags();
  const flat = flattenFolders(folders.data?.folders ?? []);
  // Popover on desktop, bottom-sheet drawer on mobile (ResponsivePopover).
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);

  // Toast copy names the count, since the cards it refers to have already left the
  // screen by the time it is read.

  // Archiving or deleting a batch is CHOREOGRAPHED, not just fired.
  //
  // Every card removed from its own action bar plays an exit (peel or recede), and
  // Undo rewinds that exit — but the bulk versions used to do neither: the request
  // went out, the cache reconciled, and a dozen rows vanished between two frames.
  // Undoing then played the rewind of an animation nobody had seen. So the bar now
  // does what a single card does for itself: tell the cards to leave, let them,
  // and only then reconcile — because the reconcile is what unmounts them, and
  // doing it eagerly is precisely what cut the animation out.
  //
  // The animation does NOT wait on the network (the cards start moving on click, as
  // they do everywhere else); the reconcile waits on whichever finishes last. If the
  // request fails, the reconcile simply brings the cards back.
  //
  // The ids are snapshotted BEFORE any of this, because `clear()` empties the
  // selection immediately — and Undo still needs to know which notes to bring back.
  const playExit = (kind: "archive" | "delete", ids: string[], onDone: () => void) => {
    beginBulkExit(ids, kind);
    // Emptying the selection here rather than on success returns the composer as the
    // cards leave, and makes a second click on a batch already on its way impossible.
    //
    // Archive and delete are the only actions that still do this. See the note at the
    // top of the file: these two take the notes off the list, so a surviving selection
    // would point at cards that are no longer there.
    clear();
    const settled = quietBulk({ action: kind, ids }).catch(() => {});
    // Waited at the CAP rather than at this batch's own longest index: the stagger a
    // card applies is derived from its position in the list, which the bar cannot
    // see. Erring long costs a few idle milliseconds before the toast; erring short
    // would unmount a card mid-peel.
    const ms = exitDurationMs(kind, { bulk: true, reduced: !!reduceMotion, index: DELETE_BULK_STAGGER_CAP });
    const played = new Promise((r) => window.setTimeout(r, ms));
    void Promise.all([settled, played]).then(() => {
      invalidate();
      onDone();
    });
  };

  const archive = () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    playExit("archive", ids, () =>
      toast(t("bulk.archived", { count: ids.length }), {
        icon: <Archive className="h-4 w-4" />,
        action: { label: t("common.undo"), onClick: () => bulk.mutate({ action: "unarchive", ids }) },
        reverse: { ids, kind: "archive" },
      })
    );
  };
  const del = () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    playExit("delete", ids, () =>
      toast(t("bulk.trashed", { count: ids.length }), {
        icon: <Trash2 className="h-4 w-4" />,
        action: { label: t("common.undo"), onClick: () => bulk.mutate({ action: "restore", ids }) },
        reverse: { ids, kind: "delete" },
      })
    );
  };
  // Move and tag are not destructive and get a plain confirmation toast with no
  // Undo — the change is visible in the list and trivially reversed by hand.
  // `folderId: null` is "take these out of any folder", offered as its own row.
  //
  // Both are idempotent on the server (a tag already present, a folder already set),
  // which is what makes leaving the selection ticked safe: the worst a double click
  // can do is apply the same change twice.
  //
  // ── Closing the popover is now this function's job ─────────────────────────
  //
  // It never used to be, and nothing in the markup does it either: ResponsivePopover
  // is fully controlled, and cmdk does not close anything on select. The popover
  // closed because `clear()` emptied the selection, which dropped the count below
  // two, which unmounted this entire component — popover included. A side effect of
  // a side effect.
  //
  // Take `clear()` away and picking a folder leaves the menu sitting open over the
  // list. So the close is explicit now, and it happens on CLICK rather than on
  // success: the menu should answer the press immediately, and the toast is what
  // reports the outcome.
  const move = (folderId: string | null, name: string) => {
    const ids = [...selectedIds];
    setMoveOpen(false);
    bulk.mutate(
      { action: "move", ids, folderId },
      {
        onSuccess: () => toast(t("bulk.moved", { count: ids.length, name })),
        onError: () => toast(t("bulk.failed"), { kind: "error" }),
      }
    );
  };
  const addTag = (tagId: string, name: string) => {
    const ids = [...selectedIds];
    setTagOpen(false);
    bulk.mutate(
      { action: "tag", ids, tagId },
      {
        onSuccess: () => toast(t("bulk.tagged", { count: ids.length, name })),
        onError: () => toast(t("bulk.failed"), { kind: "error" }),
      }
    );
  };

  return (
    <motion.div
      // ── Taking the slot, and giving it back ─────────────────────────────────
      //
      // This bar and the composer share one absolutely-positioned slot at the bottom
      // of the list, so appearing here is a HANDOVER rather than an entrance: the
      // composer drops out of the viewport and this rises from the same edge behind
      // it, and the whole thing runs backwards when the selection falls below two.
      //
      // Which is why it enters from fully below (BAR_SWAP_OFFSCREEN) rather than the
      // 40px nudge it used to do. A short rise reads as a bar that was always there
      // and just woke up; the composer, meanwhile, was visibly travelling the full
      // height of the slot to get out of the way. One of the two had to be wrong,
      // and it was this one.
      //
      // The delay is what stops the two crossing mid-flight. See BAR_SWAP_TRAIL_MS.
      //
      // `exit` only runs because ListScreen wraps this in <AnimatePresence> — without
      // that, unticking a note unmounts the bar instantly and the composer rises into
      // a slot the bar never left, which looks like the bar was deleted rather than
      // dismissed.
      initial={reduceMotion ? { opacity: 0 } : { y: BAR_SWAP_OFFSCREEN, opacity: 1 }}
      animate={{ y: 0, opacity: 1 }}
      // Leaving is not the entrance played backwards: it takes the OUT curve and the
      // OUT duration with NO delay, because on the way out this bar is the one
      // clearing the slot and the composer is the one waiting. Carried on the `exit`
      // target itself, since that is the only way to give a variant its own timing.
      exit={
        reduceMotion
          ? { opacity: 0 }
          : {
              y: BAR_SWAP_OFFSCREEN,
              opacity: 1,
              transition: { duration: BAR_SWAP_OUT_MS / 1000, ease: EASE_FOLLOW },
            }
      }
      transition={{
        duration: BAR_SWAP_IN_MS / 1000,
        ease: EASE_FOLLOW_REVERSED,
        delay: BAR_SWAP_TRAIL_MS / 1000,
      }}
      // `--kb` is the software keyboard's height (see useKeyboardInset): on a phone
      // the bar rides above the keyboard instead of being buried under it.
      style={{ bottom: "var(--kb, 0px)" }}
      // pointer-events-none on the full-width wrapper, auto on the bar itself, so
      // the empty space either side stays clickable — cards behind it remain
      // reachable instead of being blocked by an invisible band.
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)_+_1rem)]"
    >
      {/* Wears the composer's own material — `surface-elevated composer-bar` — rather
          than a hand-rolled lookalike. It stands in the composer's slot, so it should
          be the same object, and the copy had drifted: the tint came off `--background`
          at a hardcoded 80% where the composer tints `--card` at 72%, and the border
          and ring were both mixed from `--shadow-color`, which is the shadow token and
          means nothing as an edge colour. Sharing the class also picks up the
          `prefers-reduced-transparency` opaque fallback the copy never had.

          `p-3` and `gap-2` where the composer uses `p-2.5`: this bar is a row of
          targets to hit, where the composer is mostly one large text field, so its
          controls get more room around them.

          ── Why the alignment lives HERE and not on the button group ──────────
          The group used to carry `ml-auto`, which is the obvious way to say "count
          on the left, actions on the right" and is correct exactly as long as both
          fit on one line. Auto margins resolve PER FLEX LINE, so the moment the
          group wraps, `ml-auto` keeps pushing it to the right edge of its own
          line — and the whole surplus width collects to its left as a gap that
          looks like a slot something is missing from.

          Nobody saw that in English, where the five labels total 25 characters and
          never wrap. French spends 43 for the same five (Archiver, Déplacer,
          Étiqueter, Supprimer, Effacer), wraps at this width, and put an orphan gap
          on the left of Archiver. A second language is the only reason this was
          ever visible.

          `justify-between` on the container resolves per line too, so it does the
          same job when everything fits AND behaves when it wraps: count at the
          start, actions at the end on one line; each simply at the start of its own
          line once there are two. No breakpoint, no measuring.

          ── Why this bar is WIDER than the composer it takes over from ────────
          52rem against the composer's 42rem, and that asymmetry is bought
          deliberately: at the composer's width the French row does not fit, and no
          amount of tuning makes it fit.

          Measured in the system font at 14px, because these labels render in the
          system stack and the numbers are cheap to get exactly rather than estimate.
          At max-w-2xl a 672px bar is 648px of content, and the French row wants 179px
          of count ("128 notes sélectionnées") plus 578px of buttons — 765px, over
          budget by 117. Trimming every button to px-2.5 AND dropping the word off the
          last one still lands at 651.5px. It was never a padding problem: five French
          verbs and a full sentence do not fit in 648px by any arrangement. (English
          wants 624px, which is why none of this was visible until someone read the
          bar in French.)

          The width is sized for the LONGEST label, and that is the deselect control:
          "Désélectionner" is 100px where the old "Effacer" was 47. At 832px (808 of
          content) the French row totals 777px, leaving 31px of headroom at a
          three-digit count and 22px at four digits; English totals 608px and has
          200px spare.

          The cost is that the surface is not quite the same size before and after you
          tick a second note. That is a real loss against the handover this bar is
          built around, and the alternatives were worse: icon-only buttons would have
          cost every label in both languages, and dropping the icons would have cost
          the visual language the note cards use for these same five actions.

          `flex-wrap` stays as the safety net, and it still earns its place — max-w is
          a cap, not a width, so any window narrow enough to squeeze the bar below
          about 864px of list area wraps the French row regardless of the number here.
          A phone is nowhere near it, and there the count taking its own line is the
          correct answer. */}
      <div className="surface-elevated composer-bar pointer-events-auto flex w-full max-w-[52rem] flex-wrap items-center justify-between gap-2 p-3">
        {/* The count is the bar's subject — it names what every button will act on.
            It names the NOUN too ("2 notes selected", not "2 selected"): this line is
            the only thing on screen saying what the five buttons below are about to
            act on, and leaving the reader to supply "notes" made it read as a stray
            number. Widening the bar is what paid for the extra word. */}
        <span className="px-2 text-sm font-semibold">{t("bulk.selected", { count })}</span>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="default" onClick={archive} disabled={bulk.isPending} className={ACTION_BTN}>
            <Archive className="h-4 w-4" /> {t("note.archive")}
          </Button>

          <ResponsivePopover
            open={moveOpen}
            onOpenChange={setMoveOpen}
            title={t("bulk.moveToFolder")}
            align="end"
            contentClassName="w-60 p-0"
            trigger={
              <Button variant="ghost" size="default" className={ACTION_BTN}>
                <FolderInput className="h-4 w-4" /> {t("bulk.move")}
              </Button>
            }
          >
            <Command>
              <CommandInput placeholder={t("bulk.moveToFolderPlaceholder")} className="max-sm:h-12 max-sm:text-base" />
              <CommandList className="max-h-56 overflow-y-auto p-1 max-sm:max-h-[55vh] max-sm:p-1.5">
                <CommandEmpty>{t("bulk.noFolder")}</CommandEmpty>
                <CommandItem value="__none__ no folder" onSelect={() => move(null, t("selector.folder.none"))} className="max-sm:py-3 max-sm:text-base">
                  <span className="h-2.5 w-2.5 rounded-full border" /> {t("selector.folder.none")}
                </CommandItem>
                {flat.map((f) => (
                  <CommandItem key={f.id} value={`${f.name} ${f.id}`} onSelect={() => move(f.id, f.name)} className="max-sm:py-3 max-sm:text-base">
                    <span style={{ paddingLeft: f.depth * 8 }} className="flex items-center gap-2">
                      <FolderIcon className="h-3.5 w-3.5" style={{ color: f.color ?? undefined }} /> {f.name}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </ResponsivePopover>

          <ResponsivePopover
            open={tagOpen}
            onOpenChange={setTagOpen}
            title={t("bulk.addTag")}
            align="end"
            contentClassName="w-56 p-0"
            trigger={
              <Button variant="ghost" size="default" className={ACTION_BTN}>
                {/* A hash, not a luggage tag. Tags are written `#name` everywhere they
                    appear — on the cards, in the sidebar, in the tag page's title — and
                    this trigger was the one place in the app still showing the other
                    glyph, including directly above its own popover rows, which use a
                    hash. */}
                <Hash className="h-4 w-4" /> {t("bulk.tag")}
              </Button>
            }
          >
            <Command>
              <CommandInput placeholder={t("bulk.addTagPlaceholder")} className="max-sm:h-12 max-sm:text-base" />
              <CommandList className="max-h-56 overflow-y-auto p-1 max-sm:max-h-[55vh] max-sm:p-1.5">
                <CommandEmpty>{t("bulk.noTags")}</CommandEmpty>
                {(tags.data?.tags ?? []).map((t) => (
                  <CommandItem key={t.id} value={t.name} onSelect={() => addTag(t.id, t.name)} className="max-sm:py-3 max-sm:text-base">
                    <Hash className="h-3.5 w-3.5" /> {t.name}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </ResponsivePopover>

          <Button variant="ghost" size="default" onClick={del} disabled={bulk.isPending} className={`${ACTION_BTN} text-destructive hover:text-destructive`}>
            <Trash2 className="h-4 w-4" /> {t("common.delete")}
          </Button>
          {/* The way out. Labelled on desktop, icon-only on phones where horizontal
              room is scarce — the aria-label carries the meaning either way.

              The visible label is the short verb and the accessible name is the fuller
              phrase ("Deselect" / "Deselect all"), which is the right way round: the
              eye has the count sitting three inches to the left to supply the scope,
              and a screen reader announcing a bare "Deselect" does not. */}
          <Button variant="ghost" size="default" onClick={clear} aria-label={t("bulk.deselectAll")} className={ACTION_BTN}>
            <X className="h-4 w-4" /> <span className="hidden sm:inline">{t("bulk.deselect")}</span>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
