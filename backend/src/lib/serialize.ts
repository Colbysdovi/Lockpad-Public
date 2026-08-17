// Turning database rows into the JSON the app receives.
//
// Every note response in the API goes through here, which is what makes one rule
// enforceable in a single place: A LOCKED NOTE NEVER LEAVES WITH ITS CONTENTS. No
// document, no preview text, no preview blocks — only its metadata (title, folder,
// tags, dates) and the fact that ciphertext exists. Because every route serializes
// through these functions rather than returning Prisma rows directly, a new
// endpoint cannot accidentally leak a locked note's body.
//
// Two shapes are produced:
//   serializeNoteCard — what a LIST returns. Metadata plus a bounded preview.
//   serializeNote     — what OPENING a note returns. The same, plus the full
//                       document and (for a locked note) its crypto parameters.
// The card shape deliberately omits the document: fifty cards would otherwise mean
// fifty full documents on the wire for a single page of results.
//
// Dates are emitted as ISO-8601 STRINGS, never Date objects, since that is what
// survives JSON — the frontend's types.ts mirrors this by hand.
import type { Prisma } from "@prisma/client";
import { makePreview, makePreviewBlocks, makePreviewDoc, type PreviewBlock } from "./tiptap.js";

// Shape returned when a note is fetched with its relations.
export type NoteWithRelations = Prisma.NoteGetPayload<{
  include: { tags: { include: { tag: true } }; folder: true };
}>;

export interface SerializedNote {
  id: string;
  title: string;
  isLocked: boolean;
  color: string | null;
  folder: { id: string; name: string } | null;
  tags: { id: string; name: string }[];
  preview: string;
  // Structured, glanceable preview echoing the note's shape (checkboxes, bullets,
  // headings…). Empty for locked notes. `preview` (plain text) is kept alongside.
  previewBlocks: PreviewBlock[];
  // A bounded real TipTap doc (first few blocks) so cards can render the preview
  // with the exact same styling as the detail editor. Null for locked/empty notes.
  previewDoc: unknown | null;
  content: unknown | null;
  hasEncryptedContent: boolean;
  cryptoMeta: unknown | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full serialization (note detail). Locked notes omit content + preview. */
export function serializeNote(note: NoteWithRelations): SerializedNote {
  const locked = note.isLocked;
  return {
    id: note.id,
    title: note.title,
    isLocked: locked,
    color: note.color,
    folder: note.folder ? { id: note.folder.id, name: note.folder.name } : null,
    tags: note.tags.map((nt) => ({ id: nt.tag.id, name: nt.tag.name })),
    preview: locked ? "" : makePreview(note.content),
    previewBlocks: locked ? [] : makePreviewBlocks(note.content),
    previewDoc: locked ? null : makePreviewDoc(note.content),
    content: locked ? null : note.content,
    hasEncryptedContent: note.encryptedContent != null,
    cryptoMeta: locked ? note.cryptoMeta : null,
    archivedAt: note.archivedAt?.toISOString() ?? null,
    deletedAt: note.deletedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

/** List-card serialization: same as full but content is always omitted. */
export function serializeNoteCard(note: NoteWithRelations): Omit<SerializedNote, "content" | "cryptoMeta"> {
  const full = serializeNote(note);
  const { content: _c, cryptoMeta: _m, ...card } = full;
  return card;
}

export const noteInclude = {
  tags: { include: { tag: true } },
  folder: true,
} satisfies Prisma.NoteInclude;
