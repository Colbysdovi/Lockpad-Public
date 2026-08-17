import { useCallback } from "react";
import { useLocation, useMatch } from "react-router-dom";
import { useCreateNote } from "./hooks";
import { useNoteSheet } from "./useNoteSheet";

// "New note", wherever it is pressed from — the top bar button, the Cmd+N
// shortcut, the empty-state prompt.
//
// The one piece of intelligence here is CONTEXT INHERITANCE: making a note while
// looking at a folder files it into that folder, and making one while looking at a
// tag applies that tag. It saves the near-universal follow-up step of filing the
// note you just made into the place you were already standing. From anywhere else
// (All notes, search, settings) the note is created bare.
//
// The new note is opened immediately, so pressing the button lands the caret in an
// editor rather than merely adding a row to a list.
export function useNewNote() {
  const location = useLocation();
  const create = useCreateNote();
  const { openNote } = useNoteSheet();
  const folderMatch = useMatch("/folders/:id");
  const tagMatch = useMatch("/tags/:id");

  const createNote = useCallback(async () => {
    // useMatch keeps returning its last match briefly after navigating away, so the
    // current pathname is checked too — otherwise a note created just after leaving
    // a folder page could inherit the folder the user has already left.
    const folderId = location.pathname.startsWith("/folders/") ? folderMatch?.params.id : undefined;
    const tagId = location.pathname.startsWith("/tags/") ? tagMatch?.params.id : undefined;
    const note = await create.mutateAsync({
      folderId: folderId ?? undefined,
      tagIds: tagId ? [tagId] : undefined,
    });
    openNote(note.id);
  }, [create, folderMatch, tagMatch, location.pathname, openNote]);

  return { createNote, isCreating: create.isPending };
}
