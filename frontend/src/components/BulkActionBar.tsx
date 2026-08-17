import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Archive, Trash2, FolderInput, Tag as TagIcon, X, Folder as FolderIcon, Hash } from "@/components/icons";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useBulkAction, useQuietBulkAction, useFolders, useTags, useInvalidateNotes } from "@/lib/hooks";
import { beginBulkExit } from "@/lib/noteFx";
import { exitDurationMs, DELETE_BULK_STAGGER_CAP, EASE_FOLLOW } from "@/lib/motion";
import { flattenFolders } from "./selectors";
import { useSelection } from "@/lib/useSelection";
import { useToast } from "@/lib/useToast";

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
  const plural = (n: number) => `${n} note${n === 1 ? "" : "s"}`;

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
      toast(`${plural(ids.length)} archived`, {
        icon: <Archive className="h-4 w-4" />,
        action: { label: "Undo", onClick: () => bulk.mutate({ action: "unarchive", ids }) },
        reverse: { ids, kind: "archive" },
      })
    );
  };
  const del = () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    playExit("delete", ids, () =>
      toast(`${plural(ids.length)} moved to Trash`, {
        icon: <Trash2 className="h-4 w-4" />,
        action: { label: "Undo", onClick: () => bulk.mutate({ action: "restore", ids }) },
        reverse: { ids, kind: "delete" },
      })
    );
  };
  // Move and tag are not destructive and get a plain confirmation toast with no
  // Undo — the change is visible in the list and trivially reversed by hand.
  // `folderId: null` is "take these out of any folder", offered as its own row.
  const move = (folderId: string | null, name: string) => {
    const ids = [...selectedIds];
    bulk.mutate({ action: "move", ids, folderId }, { onSuccess: () => { clear(); toast(`Moved ${plural(ids.length)} to ${name}`); } });
  };
  const addTag = (tagId: string, name: string) => {
    const ids = [...selectedIds];
    bulk.mutate({ action: "tag", ids, tagId }, { onSuccess: () => { clear(); toast(`Tagged ${plural(ids.length)} with #${name}`); } });
  };

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.18, ease: EASE_FOLLOW }}
      // Rises from below on appearance — it is replacing the composer in the same
      // slot, so it enters the way the composer sits rather than fading in on top.
      // `--kb` is the software keyboard's height (see useKeyboardInset): on a phone
      // the bar rides above the keyboard instead of being buried under it.
      style={{ bottom: "var(--kb, 0px)" }}
      // pointer-events-none on the full-width wrapper, auto on the bar itself, so
      // the empty space either side stays clickable — cards behind it remain
      // reachable instead of being blocked by an invisible band.
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)_+_1rem)]"
    >
      <div
        className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-1.5 rounded-2xl border border-[rgb(var(--shadow-color)/0.08)] p-2.5 shadow-[0_2px_8px_-2px_rgb(var(--shadow-color)/0.18),0_18px_50px_-12px_rgb(var(--shadow-color)/0.5)] ring-1 ring-[rgb(var(--shadow-color)/0.12)] backdrop-blur-md"
        style={{ backgroundColor: "color-mix(in srgb, var(--background) 80%, transparent)" }}
      >
        {/* The count is the bar's subject — it names what every button will act on. */}
        <span className="px-2 text-sm font-semibold">{count} selected</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" onClick={archive} disabled={bulk.isPending} className="gap-1.5">
            <Archive className="h-4 w-4" /> Archive
          </Button>

          <ResponsivePopover
            open={moveOpen}
            onOpenChange={setMoveOpen}
            title="Move to folder"
            align="end"
            contentClassName="w-60 p-0"
            trigger={
              <Button variant="ghost" size="sm" className="gap-1.5">
                <FolderInput className="h-4 w-4" /> Move
              </Button>
            }
          >
            <Command>
              <CommandInput placeholder="Move to folder…" className="max-sm:h-12 max-sm:text-base" />
              <CommandList className="max-h-56 overflow-y-auto p-1 max-sm:max-h-[55vh] max-sm:p-1.5">
                <CommandEmpty>No folder found.</CommandEmpty>
                <CommandItem value="__none__ no folder" onSelect={() => move(null, "No folder")} className="max-sm:py-3 max-sm:text-base">
                  <span className="h-2.5 w-2.5 rounded-full border" /> No folder
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
            title="Add tag"
            align="end"
            contentClassName="w-56 p-0"
            trigger={
              <Button variant="ghost" size="sm" className="gap-1.5">
                <TagIcon className="h-4 w-4" /> Tag
              </Button>
            }
          >
            <Command>
              <CommandInput placeholder="Add tag…" className="max-sm:h-12 max-sm:text-base" />
              <CommandList className="max-h-56 overflow-y-auto p-1 max-sm:max-h-[55vh] max-sm:p-1.5">
                <CommandEmpty>No tags yet.</CommandEmpty>
                {(tags.data?.tags ?? []).map((t) => (
                  <CommandItem key={t.id} value={t.name} onSelect={() => addTag(t.id, t.name)} className="max-sm:py-3 max-sm:text-base">
                    <Hash className="h-3.5 w-3.5" /> {t.name}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </ResponsivePopover>

          <Button variant="ghost" size="sm" onClick={del} disabled={bulk.isPending} className="gap-1.5 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          {/* The way out. Labelled on desktop, icon-only on phones where horizontal
              room is scarce — the aria-label carries the meaning either way. */}
          <Button variant="ghost" size="sm" onClick={clear} aria-label="Unselect all" className="gap-1.5">
            <X className="h-4 w-4" /> <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
