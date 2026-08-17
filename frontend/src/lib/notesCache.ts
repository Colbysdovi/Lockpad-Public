import type { QueryClient, InfiniteData } from "@tanstack/react-query";
import type { NotesPage, NoteCard } from "./types";

// Merge `patch` into the matching note's card across every cached ["notes", …]
// infinite-query, IN PLACE — the card's fields refresh but its position doesn't
// change. This keeps the list live while a note is edited without the note
// jumping to the top on every keystroke; the correct (updatedAt-desc) order is
// restored on the next refetch (navigation, or window-focus — see useNotesList).
// `patch` can be a function of the current card for updates that depend on it
// (e.g. removing one tag from the card's tag list).
export function patchNoteInLists(
  qc: QueryClient,
  noteId: string,
  patch: Partial<NoteCard> | ((card: NoteCard) => Partial<NoteCard>)
) {
  qc.setQueriesData<InfiniteData<NotesPage>>({ queryKey: ["notes"] }, (data) => {
    if (!data) return data;
    let changed = false;
    const pages = data.pages.map((page) => {
      const idx = page.notes.findIndex((n) => n.id === noteId);
      if (idx === -1) return page;
      changed = true;
      const notes = page.notes.slice();
      notes[idx] = { ...notes[idx], ...(typeof patch === "function" ? patch(notes[idx]) : patch) };
      return { ...page, notes };
    });
    return changed ? { ...data, pages } : data;
  });
}
