import { Pin } from "@/components/icons";
import { usePins } from "@/lib/hooks";
import { NoteCard } from "./NoteCard";
import { useT } from "@/lib/i18n";

// Per-page "Pinned" section (spec: note hover-state §2). Renders above the
// regular list (via NoteList's header slot) the notes pinned in this page's
// scope, most-recently-pinned first. Hidden entirely while loading or when no
// note is pinned here, so its very first pin creates the section and its last
// unpin removes it. Cards reuse NoteCard with `pinned` so the toggle shows filled.
export function PinnedSection({ scope }: { scope: string }) {
  const t = useT();
  const query = usePins(scope);

  const notes = query.data?.notes ?? [];
  if (query.isLoading || notes.length === 0) return null;

  return (
    <section className="mb-5 border-b pb-5" aria-label={t("list.pinnedNotes")}>
      <div className="mb-3 flex items-center gap-2 px-1">
        <Pin className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("list.pinned")}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{notes.length}</span>
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
        {notes.map((note, i) => (
          <NoteCard key={note.id} note={note} filter="active" scope={scope} pinned index={i} />
        ))}
      </div>
    </section>
  );
}

// Heading for the regular (unpinned) list, shown ONLY when a Pinned section exists
// above it — so the two groups read as a labelled pair. Mirrors the "PINNED" header
// styling. Rendered right below PinnedSection via NoteList's header slot.
export function UnpinnedHeading({ scope }: { scope: string }) {
  const t = useT();
  const query = usePins(scope);
  const pinned = query.data?.notes ?? [];
  if (query.isLoading || pinned.length === 0) return null;

  return (
    <div className="mb-3 flex items-center gap-2 px-1" aria-hidden>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("list.unpinned")}</h2>
    </div>
  );
}
