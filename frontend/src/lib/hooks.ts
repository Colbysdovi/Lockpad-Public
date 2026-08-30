// Every read and write the app makes, as hooks.
//
// This is the data layer: TanStack Query sits between the components and api.ts and
// owns the caching, so a component asks for "the notes in this folder" and gets a
// cached answer, a loading state, and automatic refetching without managing any of
// it. Components should not call `api` directly — routing everything through here
// is what keeps the cache consistent after a write.
//
// THE CACHE KEYS, and why they are shaped this way:
//   ["notes", params]  one entry per list view (All / a folder / a tag / archive /
//                      trash), because each is a different query with different
//                      results. Infinite queries — pages are appended as you scroll.
//   ["note", id]       one open note, WITH its document. Fetched only when opened.
//   ["pins", scope]    the pinned section for one page; pins are per-page, so the
//                      scope ("all", "folder:<id>", "tag:<id>") is part of the key.
//   ["folders"]        the whole folder tree, already nested by the server.
//   ["tags"]           every tag with its note count.
//   ["links", noteId]  a note's outgoing links and its backlinks.
//   ["search", q]      search results for one query string.
//
// AFTER A WRITE there are two strategies here, and the choice matters:
//   - INVALIDATE (useInvalidateNotes) when the change should reorder or add/remove
//     cards. Refetches from the server, which is authoritative.
//   - PATCH IN PLACE (patchNoteInLists) when it must NOT reorder — editing a note,
//     or changing its folder from an open popover. A refetch would re-sort the list
//     by updatedAt, remount the card, and close the popover the user is still using.
//     Order corrects itself on the next natural refetch.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api";
import { patchNoteInLists } from "./notesCache";
import { markComposing, captureReflow } from "./noteFx";
import type { Folder, LinkRef, Note, NoteCard, NotesPage, SearchResult, Tag } from "./types";
import type { NoteColor } from "./noteColors";

/** Which pile of notes a list is showing. Archive and trash are soft states on the
 *  note itself, so these are filters over one table, not separate collections. */
export type ListFilter = "active" | "trash" | "archive";
export interface ListParams {
  folderId?: string;
  tagId?: string;
  filter?: ListFilter;
  // Per-page pin scope; when set the list excludes notes pinned in this scope.
  scope?: string;
}

// Build a query string, dropping anything undefined or empty so optional filters
// simply don't appear rather than arriving as "folderId=undefined".
const qs = (p: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

// Invalidate everything that can change when notes mutate. Exported so a caller that
// plays an exit animation can DEFER the reconcile until the animation has finished —
// the refetch is what unmounts the card, so doing it eagerly would cut the exit short.
//
// This is also the one seam every list-reordering mutation passes through, so it is
// where the grid's current layout gets photographed. Adding or removing a note shifts
// every card after it, and the virtualizer applies that in a single frame — the list
// used to jump. With a snapshot taken here, each surviving card slides from where it
// was to where it now is (see useReflowFlip) instead of teleporting. Capturing costs
// one layout read of the mounted cards, and only matters for the ~600ms window after
// an action: a refetch from scrolling or window focus finds no snapshot and is static.
// The PINNED section is refreshed here too, and it has to be. Every action that comes
// through this seam can change what belongs in it: deleting or archiving a pinned note
// takes it out (the pins query filters on deletedAt/archivedAt), restoring or
// unarchiving puts it back (the pin row itself survives a soft delete), and a duplicate
// inherits its original's pins. Leaving it out was a real bug — the pinned section kept
// serving its stale list, so a deleted card stayed mounted in its finished exit state
// and left a hole in the grid where the reflow should have been, with the section's
// count still including it.
//
// Unscoped (every scope) rather than the current page's: an action can affect a note
// pinned in scopes other than the one being looked at, and only one pinned section is
// mounted at a time, so this refetches one small query rather than many.
export function useInvalidateNotes() {
  const qc = useQueryClient();
  return () => {
    captureReflow();
    qc.invalidateQueries({ queryKey: ["notes"] });
    qc.invalidateQueries({ queryKey: ["note"] });
    qc.invalidateQueries({ queryKey: ["pins"] });
  };
}

/** One page of notes, with infinite scrolling. The server returns a `nextCursor`
 *  which is fed straight back to fetch the following page (cursor pagination — it
 *  cannot skip or repeat a note when the list changes underneath you, which
 *  offset pagination can). */
export function useNotesList(params: ListParams) {
  return useInfiniteQuery({
    queryKey: ["notes", params],
    initialPageParam: "" as string,
    queryFn: ({ pageParam }) =>
      api.get<NotesPage>(`/notes${qs({ ...params, limit: 50, cursor: pageParam || undefined })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Safety net (#5): the global default disables focus refetch, but the note
    // list should self-heal — coming back to the tab or reconnecting refetches
    // so any drift (and the updatedAt-desc ordering) is reconciled with the server.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/** One open note, including its document. Disabled until an id exists, so the hook
 *  can be called unconditionally from a component that may have no note open. */
export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: ["note", id],
    queryFn: () => api.get<Note>(`/notes/${id}`),
    enabled: !!id,
  });
}

// Per-page pins. Scope is "all" | "folder:<id>" | "tag:<id>". The list query for
// the same scope excludes these notes so they render only in the Pinned section.
export function usePins(scope: string | undefined) {
  return useQuery({
    queryKey: ["pins", scope],
    queryFn: () => api.get<{ notes: NoteCard[] }>(`/notes/pins${qs({ scope })}`),
    enabled: !!scope,
  });
}

export function usePinActions() {
  const qc = useQueryClient();
  const invalidate = (scope: string) => {
    // Pinning moves a card between two containers: one slot closes, another opens.
    captureReflow();
    qc.invalidateQueries({ queryKey: ["pins", scope] });
    qc.invalidateQueries({ queryKey: ["notes"] });
  };
  return {
    pin: useMutation({
      mutationFn: ({ noteId, scope }: { noteId: string; scope: string }) =>
        api.post(`/notes/${noteId}/pin`, { scope }),
      onSuccess: (_d, v) => invalidate(v.scope),
    }),
    unpin: useMutation({
      mutationFn: ({ noteId, scope }: { noteId: string; scope: string }) =>
        api.del(`/notes/${noteId}/pin${qs({ scope })}`),
      onSuccess: (_d, v) => invalidate(v.scope),
    }),
  };
}

/** Create a note. Optionally pre-filled with a folder or tags — see useNewNote,
 *  which inherits them from whichever page you were looking at. */
export function useCreateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (body: { title?: string; content?: unknown; folderId?: string | null; tagIds?: string[]; color?: string | null }) =>
      api.post<Note>("/notes", body),
    onSuccess: (note) => {
      // Claim the note as "being composed" BEFORE the list refresh, so an empty new
      // note is never rendered as a blank card even for one frame (the list gate in
      // NoteList holds it back until it has real content). A note created WITH
      // content is unaffected — the gate also requires the card to be blank.
      markComposing(note.id);
      invalidate();
    },
  });
}

/** Copy a note, title, content, folder, tags and pins. Refused for locked notes: the
 *  server holds only ciphertext, so it has nothing it could duplicate. */
export function useDuplicateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (id: string) => api.post<Note>(`/notes/${id}/duplicate`),
    // The copy inherits its original's pins, so duplicating a pinned note adds a card
    // to the PINNED section rather than to the list below — which the shared
    // invalidate already refreshes.
    onSuccess: invalidate,
  });
}

/** What the multi-select bar can do to a batch of notes at once. The server applies
 *  the whole batch in one transaction, so a bulk action never half-completes. */
export type BulkAction = "archive" | "unarchive" | "delete" | "restore" | "move" | "tag" | "color";
export function useBulkAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: BulkAction; ids: string[]; folderId?: string | null; tagId?: string; color?: NoteColor | null }) =>
      api.post<{ count: number }>("/notes/bulk", body),
    onSuccess: () => {
      // A bulk action can remove a dozen cards at once — the biggest reflow there is.
      captureReflow();
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["note"] });
      qc.invalidateQueries({ queryKey: ["pins"] });
    },
  });
}

/** Save changes to a note (title, content, folder, colour) from anywhere that is
 *  not the autosaving editor — the editor has its own debounced path in
 *  useAutoSave. */
export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; content?: unknown; folderId?: string | null; color?: NoteColor | null }) =>
      api.patch<Note>(`/notes/${id}`, body),
    onSuccess: (note) => {
      qc.setQueryData(["note", note.id], note);
      // Patch the visible card IN PLACE instead of invalidating: a folder change from
      // the Organize popover must not reorder the list mid-interaction — a reorder
      // remounts the card (rows are index-keyed) and kills the open popover, and it
      // would also cut short the accent draw/erase animation. Order corrects on the
      // next natural refetch (navigation/focus) — same policy as useAutoSave.
      patchNoteInLists(qc, note.id, note);
    },
  });
}

/** Cache-SILENT delete/archive. The card that triggers these plays an exit animation
 *  and reconciles the cache itself once the animation is done (see NoteCard) — a
 *  mutation that invalidated on its own would unmount the card mid-animation. Undo
 *  (restore/unarchive) still goes through useNoteAction, which reconciles normally. */
export function useQuietNoteActions() {
  return {
    del: (id: string) => api.del(`/notes/${id}`),
    archive: (id: string) => api.post(`/notes/${id}/archive`),
  };
}

/** The bulk call WITHOUT the cache reconcile, for the two actions that animate their
 *  cards away (archive, delete). Same bargain as useQuietNoteActions: the reconcile
 *  is what unmounts a card, so a caller that is playing an exit has to own the timing
 *  of it. Everything else on the bulk bar keeps using useBulkAction, which reconciles
 *  immediately — nothing is leaving the screen, so there is nothing to wait for. */
export function useQuietBulkAction() {
  return (body: { action: BulkAction; ids: string[] }) =>
    api.post<{ count: number }>("/notes/bulk", body);
}

export function useNoteAction() {
  const invalidate = useInvalidateNotes();
  return {
    del: useMutation({ mutationFn: (id: string) => api.del(`/notes/${id}`), onSuccess: invalidate }),
    restore: useMutation({ mutationFn: (id: string) => api.post(`/notes/${id}/restore`), onSuccess: invalidate }),
    permanent: useMutation({ mutationFn: (id: string) => api.del(`/notes/${id}/permanent`), onSuccess: invalidate }),
    archive: useMutation({ mutationFn: (id: string) => api.post(`/notes/${id}/archive`), onSuccess: invalidate }),
    unarchive: useMutation({ mutationFn: (id: string) => api.post(`/notes/${id}/unarchive`), onSuccess: invalidate }),
  };
}

/** The folder tree, nested by the server. One query for the whole hierarchy — it is
 *  small, and the sidebar needs all of it at once anyway. */
export function useFolders() {
  return useQuery({ queryKey: ["folders"], queryFn: () => api.get<{ folders: Folder[] }>("/folders") });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; color?: string | null; parentFolderId?: string | null }) =>
      api.post<Folder>("/folders", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["folders"] }),
  });
}

export function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; color?: string | null; parentFolderId?: string | null }) =>
      api.patch<Folder>(`/folders/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      // A folder's colour is the source of every derived note accent (folderColor.ts),
      // so refresh note lists + the open note too — their strips recolour immediately.
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["note"] });
      // The pinned section is a separate query with its own cache, and its cards
      // carry the same folder chip and the same derived accent strip. Without this
      // a rename or recolour reached every card EXCEPT the pinned ones — the same
      // omission that was found on the tag rename above, and it was here first.
      qc.invalidateQueries({ queryKey: ["pins"] });
    },
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/folders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["note"] });
    },
  });
}

/** Every tag, each with the number of notes carrying it. The count drives the
 *  sidebar's "frequently used" grouping and the unused-tag cleanup. */
export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api.get<{ tags: Tag[] }>("/tags") });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Tag>("/tags", { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });
}

/** Rename a tag. The only way to change a tag's own record.
 *
 *  Invalidates NOTES as well as the tag list, and that is not belt-and-braces: every
 *  note card renders its tags as chips carrying the name, and the open note shows
 *  them too. Refreshing only `["tags"]` would rename it in the sidebar and leave the
 *  old spelling on every card that carries it. */
export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<Tag>(`/tags/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["note"] });
      // And the PINNED section, which is a separate query with its own cache. Its
      // cards render tag chips exactly like the ones below it, so leaving it out
      // renamed the tag everywhere except on the pinned cards — caught by looking,
      // not by reasoning: three pinned cards sat there still spelling it the old way
      // while the sidebar and every unpinned card had already updated.
      qc.invalidateQueries({ queryKey: ["pins"] });
    },
  });
}

export function useTagActions() {
  const qc = useQueryClient();
  return {
    apply: useMutation({
      // The apply route returns the full updated note, so the card and detail caches
      // are patched in place from the response — no list invalidation, no reorder,
      // so an open Organize popover survives the change (see useUpdateNote).
      mutationFn: ({ noteId, name, tagId }: { noteId: string; name?: string; tagId?: string }) =>
        api.post<Note>(`/notes/${noteId}/tags`, { name, tagId }),
      onSuccess: (note) => {
        qc.setQueryData(["note", note.id], note);
        patchNoteInLists(qc, note.id, note);
        qc.invalidateQueries({ queryKey: ["tags"] }); // sidebar counts
      },
    }),
    remove: useMutation({
      // Remove returns 204, so the caches are patched client-side by dropping the tag.
      mutationFn: ({ noteId, tagId }: { noteId: string; tagId: string }) =>
        api.del(`/notes/${noteId}/tags/${tagId}`),
      onSuccess: (_res, { noteId, tagId }) => {
        patchNoteInLists(qc, noteId, (card) => ({ tags: card.tags.filter((t) => t.id !== tagId) }));
        qc.setQueryData<Note>(["note", noteId], (n) =>
          n ? { ...n, tags: n.tags.filter((t) => t.id !== tagId) } : n
        );
        qc.invalidateQueries({ queryKey: ["tags"] });
      },
    }),
  };
}

// ── Unused tags & folders (Settings cleanup) ────────────────────────────────
//
// Two definitions of "unused", both counting EVERY note — archived and trashed
// included. A trashed note can be restored, and it would come back into a folder
// or missing a tag that no longer exists, so "empty except for binned notes" is
// not empty.
//
// Unused TAGS need no endpoint of their own: /tags already reports a per-tag note
// count (the sidebar groups by it), and that count is exactly the test. Unused
// FOLDERS do, because the test is about a whole subtree — see /folders/unused.

export interface UnusedFolder {
  id: string;
  name: string;
  color: string | null;
  /** Empty folders nested inside this one, which its deletion also removes. */
  descendantCount: number;
}

export function useUnusedTags(enabled: boolean) {
  return useQuery({
    queryKey: ["tags"],
    queryFn: () => api.get<{ tags: Tag[] }>("/tags"),
    enabled,
    // Shares the sidebar's ["tags"] cache, so without this the dialog could open
    // on data up to the default staleTime old — and this list is only meaningful
    // as of the moment it is shown. Re-ask on every open.
    refetchOnMount: "always",
    select: (data) =>
      data.tags
        .filter((t) => t.noteCount === 0)
        .map((t) => ({ id: t.id, name: t.name, color: null as string | null, descendantCount: 0 })),
  });
}

export function useUnusedFolders(enabled: boolean) {
  return useQuery({
    queryKey: ["folders", "unused"],
    queryFn: () => api.get<{ folders: UnusedFolder[] }>("/folders/unused"),
    enabled,
    // Always re-ask on open: this list is only meaningful as of right now, and a
    // cached one could offer a folder that has since been filled.
    staleTime: 0,
    refetchOnMount: "always",
    select: (data) => data.folders,
  });
}

export function useCleanupActions() {
  const qc = useQueryClient();
  // Deleting either kind changes the sidebar and, for folders, every note's derived
  // accent colour — so refresh both alongside the cleanup lists themselves.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tags"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["notes"] });
  };
  return {
    deleteTag: useMutation({
      mutationFn: (id: string) => api.del(`/tags/${id}`),
      onSuccess: refresh,
    }),
    deleteFolderSubtree: useMutation({
      mutationFn: (id: string) => api.del<{ deleted: number }>(`/folders/${id}/subtree`),
      onSuccess: refresh,
    }),
    // The bulk routes take no ids on purpose — the server recomputes what is unused
    // at the moment it runs, so a list that went stale while the dialog was open
    // cannot cause a delete of something now in use.
    cleanupTags: useMutation({
      mutationFn: () => api.post<{ deleted: number }>("/tags/cleanup", {}),
      onSuccess: refresh,
    }),
    cleanupFolders: useMutation({
      mutationFn: () => api.post<{ deleted: number; subtrees: number }>("/folders/cleanup", {}),
      onSuccess: refresh,
    }),
  };
}

/** A note's links in both directions: `links` are the notes it points at, and
 *  `backlinks` are the notes pointing at it. Backlinks are what make the [[ ]]
 *  syntax worth using — a note accumulates its own incoming context for free. */
export function useLinks(noteId: string | undefined) {
  return useQuery({
    queryKey: ["links", noteId],
    queryFn: () => api.get<{ links: LinkRef[]; backlinks: LinkRef[] }>(`/notes/${noteId}/links`),
    enabled: !!noteId,
  });
}

export function useLinkActions() {
  const qc = useQueryClient();
  const invalidate = (noteId: string) => qc.invalidateQueries({ queryKey: ["links", noteId] });
  return {
    create: useMutation({
      mutationFn: ({ noteId, targetNoteId }: { noteId: string; targetNoteId: string }) =>
        api.post(`/notes/${noteId}/links`, { targetNoteId }),
      onSuccess: (_d, v) => invalidate(v.noteId),
    }),
    remove: useMutation({
      mutationFn: ({ noteId, targetId }: { noteId: string; targetId: string }) =>
        api.del(`/notes/${noteId}/links/${targetId}`),
      onSuccess: (_d, v) => invalidate(v.noteId),
    }),
  };
}

/** Full-text search across titles and note text. Disabled for an empty query so
 *  opening the palette does not fire a request for everything. */
export function useSearch(q: string) {
  return useQuery({
    queryKey: ["search", q],
    queryFn: () => api.get<{ results: SearchResult[] }>(`/notes/search${qs({ q })}`),
    enabled: q.trim().length > 0,
  });
}

/** Title lookup for note pickers — narrows on every keystroke.
 *
 *  Deliberately NOT useSearch. Full-text search matches whole words and drops
 *  English stop words, so a picker built on it shows nothing for "onboar" and
 *  nothing at all for "why" — see the /notes/lookup route for the measurements.
 *
 *  No `enabled` gate either: an empty query is a real request here, answered with
 *  the most recently touched notes, so the picker opens with something in it. */
export function useNoteLookup(q: string) {
  return useQuery({
    queryKey: ["noteLookup", q],
    queryFn: () => api.get<{ results: NoteLookupResult[] }>(`/notes/lookup${qs({ q })}`),
  });
}

export interface NoteLookupResult {
  id: string;
  title: string;
  isLocked: boolean;
}
