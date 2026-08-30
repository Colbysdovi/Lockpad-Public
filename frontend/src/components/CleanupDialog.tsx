import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Trash2, Loader2, Check, Hash, Folder } from "@/components/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUnusedFolders, useUnusedTags, useCleanupActions } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

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
  const t = useT();
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
      setError(e instanceof Error ? e.message : t("cleanup.gone"));
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
      setError(t("cleanup.failed"));
      setConfirmOpen(false);
    }
  };

  const count = items.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileSheet className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>{isTags ? t("settings.cleanupTags.title") : t("settings.cleanupFolders.title")}</DialogTitle>
          <DialogDescription>
            {isTags
              ? t("cleanup.tags.description")
              : t("cleanup.folders.description")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("cleanup.checking")}</p>
        ) : count === 0 ? (
          // The empty state is the GOOD outcome here, so it reads as reassurance
          // rather than as an absence.
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Check className="h-7 w-7 text-success" />
            <p className="text-sm text-muted-foreground">
              {isTags ? t("cleanup.tags.nothing") : t("cleanup.folders.nothing")}
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
                {/* Two counted entries rather than one with a noun spliced in: the
                    adjective agrees with its noun in French ("inutilisée" against
                    "étiquette", "inutilisé" against "dossier"), which a shared string
                    cannot express. */}
                {isTags
                  ? t("cleanup.tags.count", { count })
                  : t("cleanup.folders.count", { count })}
              </span>
              <Button
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
                disabled={bulk.isPending || busyId !== null}
                className="gap-1.5 max-sm:h-12 max-sm:text-base"
              >
                <Trash2 className="h-4 w-4" />
                {bulk.isPending ? t("cleanup.deleting") : t("cleanup.deleteAll")}
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
              ? t("cleanup.tags.confirm")
              : t("cleanup.folders.confirm")
          }
          confirmLabel={bulk.isPending ? t("cleanup.deleting") : t("cleanup.deletePermanently")}
          destructive
          pending={bulk.isPending}
          onConfirm={removeAll}
        />
      </DialogContent>
    </Dialog>
  );
}
