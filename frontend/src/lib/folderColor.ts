import { useMemo } from "react";
import { useFolders } from "./hooks";
import type { Folder } from "./types";

// Folder-derived note colour (idea-brief-folder-derived-note-color.md). A note's
// accent is NOT stored on the note — it is computed at render time from the folder
// it lives in, walking UP to the nearest colored ancestor if the direct folder has
// no colour of its own. This means recolouring a folder instantly recolours every
// note in it (and every uncolored descendant folder's notes), with no migration and
// no stale-colour risk. Folder colours are raw hex strings (Folder.color), the same
// value the sidebar tints the folder icon with, so a note's accent always matches
// its folder's icon.

function indexFolders(folders: Folder[], map: Map<string, Folder> = new Map()): Map<string, Folder> {
  for (const f of folders) {
    map.set(f.id, f);
    indexFolders(f.children, map);
  }
  return map;
}

/**
 * The accent colour for a note, given its folder id and the folder tree. Walks from
 * the note's folder up the `parentFolderId` chain to the nearest ancestor with a
 * colour. Returns null for: no folder, or no colored folder anywhere up the chain.
 */
export function deriveFolderColor(folderId: string | null | undefined, folders: Folder[]): string | null {
  if (!folderId) return null;
  const byId = indexFolders(folders);
  let cur: Folder | undefined = byId.get(folderId);
  const seen = new Set<string>(); // terminate even on (unexpected) cyclic parent data
  while (cur && !seen.has(cur.id)) {
    if (cur.color) return cur.color;
    seen.add(cur.id);
    cur = cur.parentFolderId ? byId.get(cur.parentFolderId) : undefined;
  }
  return null;
}

/** Hook form: derive a note's accent from the live (cached) folder tree. */
export function useFolderAccent(folderId: string | null | undefined): string | null {
  const { data } = useFolders();
  const folders = data?.folders;
  return useMemo(() => deriveFolderColor(folderId, folders ?? []), [folderId, folders]);
}
