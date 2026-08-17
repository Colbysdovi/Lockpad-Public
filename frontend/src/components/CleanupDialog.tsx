import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Trash2, Loader2, Check, Hash, Folder } from "@/components/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUnusedFolders, useUnusedTags, useCleanupActions } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// "Delete unused tags" / "Delete unused folders" — one component for both, because
// they are the same interaction over two definitions of unused:
//
//   tag    — on zero notes, counting archived and TRASHED ones. A tag whose only
//            notes are in the bin is not unused: restore one and it would come back
//            stripped of a tag nobody chose to remove.
//   folder — its whole subtree (itself + every descendant) holds zero notes, by the
//            same counting rule. Only the TOP of each empty subtree is listed, since
//            deleting it takes everything beneath it too.
//
// Deletions here are final — folders and tags have no trash and no undo — so the
// bulk action asks first. The per-item deletes do not: one tag, named, with a
// visible row that disappears, is a small enough step to take at its word.

export type CleanupKind = "tags" | "folders";

export function CleanupDialog({
  kind,
  open,
  onOpenChange,
}: {
  kind: CleanupKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isTags = kind === "tags";
  // Only fetch while the dialog is open — the list is a snapshot taken at open, and
  // the server re-checks every delete anyway (see the cleanup routes), so there is
  // nothing to gain from keeping it warm.
  const tags = useUnusedTags(open && isTags);
  const folders = useUnusedFolders(open && !isTags);
  const query = isTags ? tags : folders;
  const { deleteTag, deleteFolderSubtree, cleanupTags, cleanupFolders } = useCleanupActions();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = query.data ?? [];
  const loading = query.isPending;
  const bulk = isTags ? cleanupTags : cleanupFolders;

  const removeOne = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      if (isTags) await deleteTag.mutateAsync(id);
      else await deleteFolderSubtree.mutateAsync(id);
    } catch (e) {
      // The server re-checks eligibility, so this is the honest path for "someone
      // filed a note in here while the dialog was open" — surface its reason rather
      // than a generic failure, and leave the list to refetch itself.
      setError(e instanceof Error ? e.message : "That item could no longer be deleted.");
      query.refetch();
    } finally {
      setBusyId(null);
    }
  };

  const removeAll = async () => {
    setError(null);
    try {
      await bulk.mutateAsync();
      setConfirmOpen(false);
    } catch {
      setError("Cleanup failed. Please try again.");
      setConfirmOpen(false);
    }
  };

  const noun = isTags ? "tag" : "folder";
  const count = items.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileSheet className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>{isTags ? "Delete unused tags" : "Delete unused folders"}</DialogTitle>
          <DialogDescription>
            {isTags
              ? "Tags that aren’t on a single note — including notes in the archive or the trash. Deleting one changes nothing else in your library."
              : "Folders with no notes anywhere inside them, at any depth. Deleting one also removes the empty folders nested within it."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Checking your library…</p>
        ) : count === 0 ? (
          // The empty state is the GOOD outcome here, so it reads as reassurance
          // rather than as an absence.
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Check className="h-7 w-7 text-success" />
            <p className="text-sm text-muted-foreground">
              Nothing to clean up — every {noun} is in use.
            </p>
          </div>
        ) : (
          <>
            <ul className="-mx-1 max-h-[45vh] overflow-y-auto overscroll-contain px-1">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 rounded-lg py-1.5 pl-2 pr-1 hover-scrim"
                >
                  {isTags ? (
                    <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Folder
                      className="h-4 w-4 shrink-0"
                      style={{ color: item.color ?? "var(--muted-foreground)" }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                  {/* A subtree's hidden cost, stated before you delete it: this row
                      takes more than the one folder it names. */}
                  {!isTags && item.descendantCount > 0 && (
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      +{item.descendantCount} empty inside
                    </span>
                  )}
                  <Tooltip label={`Delete ${item.name}`}>
                    <button
                      type="button"
                      aria-label={`Delete ${item.name}`}
                      disabled={busyId !== null || bulk.isPending}
                      onClick={() => removeOne(item.id)}
                      className={cn(
                        "icon-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                        "text-muted-foreground hover-scrim hover:text-destructive",
                        "disabled:pointer-events-none disabled:opacity-40"
                      )}
                    >
                      {busyId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-3 border-t pt-4 max-sm:pt-5">
              <span className="text-sm text-muted-foreground">
                {count} unused {noun}
                {count === 1 ? "" : isTags ? "s" : "s"}
              </span>
              <Button
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
                disabled={bulk.isPending || busyId !== null}
                className="gap-1.5 max-sm:h-12 max-sm:text-base"
              >
                <Trash2 className="h-4 w-4" />
                {bulk.isPending ? "Deleting…" : "Delete all"}
              </Button>
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={isTags ? `Delete ${count} unused tag${count === 1 ? "" : "s"}?` : `Delete ${count} unused folder${count === 1 ? "" : "s"}?`}
          description={
            isTags
              ? "These tags are on no notes at all, so no note changes. Tags have no trash — this cannot be undone."
              : "These folders, and the empty folders inside them, hold no notes anywhere. Folders have no trash — this cannot be undone. No note is moved or deleted."
          }
          confirmLabel={bulk.isPending ? "Deleting…" : "Delete permanently"}
          destructive
          pending={bulk.isPending}
          onConfirm={removeAll}
        />
      </DialogContent>
    </Dialog>
  );
}
