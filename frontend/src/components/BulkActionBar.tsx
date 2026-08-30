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
// Every action clears the selection afterwards. Acting on a batch means you are done
// with that batch; leaving it ticked invites accidentally acting on it twice.
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
  const move = (folderId: string | null, name: string) => {
    const ids = [...selectedIds];
    bulk.mutate({ action: "move", ids, folderId }, { onSuccess: () => { clear(); toast(t("bulk.moved", { count: ids.length, name })); } });
  };
  const addTag = (tagId: string, name: string) => {
    const ids = [...selectedIds];
    bulk.mutate({ action: "tag", ids, tagId }, { onSuccess: () => { clear(); toast(t("bulk.tagged", { count: ids.length, name })); } });
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
          controls get more room around them. */}
      <div className="surface-elevated composer-bar pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-2 p-3">
        {/* The count is the bar's subject — it names what every button will act on. */}
        <span className="px-2 text-sm font-semibold">{t("bulk.selected", { count })}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="default" onClick={archive} disabled={bulk.isPending} className="gap-1.5">
            <Archive className="h-4 w-4" /> {t("note.archive")}
          </Button>

          <ResponsivePopover
            open={moveOpen}
            onOpenChange={setMoveOpen}
            title={t("bulk.moveToFolder")}
            align="end"
            contentClassName="w-60 p-0"
            trigger={
              <Button variant="ghost" size="default" className="gap-1.5">
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
              <Button variant="ghost" size="default" className="gap-1.5">
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

          <Button variant="ghost" size="default" onClick={del} disabled={bulk.isPending} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" /> {t("common.delete")}
          </Button>
          {/* The way out. Labelled on desktop, icon-only on phones where horizontal
              room is scarce — the aria-label carries the meaning either way. */}
          <Button variant="ghost" size="default" onClick={clear} aria-label={t("bulk.unselectAll")} className="gap-1.5">
            <X className="h-4 w-4" /> <span className="hidden sm:inline">{t("bulk.clear")}</span>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
