import { Archive } from "@/components/icons";
import { useNotesList, type ListParams } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { NoteCard } from "./NoteCard";

// Contextual "Archived" section for folder/tag pages. Shows only archived notes
// that still match the current folder / tag — the match is a live server query
// (filter=archive + folderId|tagId), so a note whose folder was deleted or whose
// tag was removed drops out automatically on the next refetch. Sorting mirrors
// the global Archive page (updatedAt desc). Actions come from the shared NoteCard
// archive branch (Unarchive + open), matching the global Archive page exactly.
//
// Rendered as a footer inside the active list's scroll container, so it sits
// directly below the active notes and shares one natural scroll. Hidden entirely
// while loading or when no archived notes match (no placeholder clutter).
export function ArchivedSection({
  scope,
}: {
  scope: { folderId: string } | { tagId: string };
}) {
  const params: ListParams = { filter: "archive", ...scope };
  const query = useNotesList(params);

  const notes = query.data?.pages.flatMap((p) => p.notes) ?? [];
  if (query.isLoading || notes.length === 0) return null;

  return (
    <section className="mt-6 rounded-xl border border-dashed bg-[color-mix(in_srgb,var(--muted)_30%,transparent)] p-3" aria-label="Archived notes">
      <div className="mb-3 flex items-center gap-2 px-1">
        <Archive className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Archived</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {notes.length}
          {query.hasNextPage ? "+" : ""}
        </span>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} filter="archive" />
        ))}
      </div>

      {query.hasNextPage && (
        <div className="flex justify-center pt-3">
          <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? "Loading…" : "Load more archived"}
          </Button>
        </div>
      )}
    </section>
  );
}
