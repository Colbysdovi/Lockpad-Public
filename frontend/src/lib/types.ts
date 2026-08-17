// The shape of everything the backend sends back.
//
// These mirror backend/src/lib/serialize.ts by hand — there is no code generation
// between the two, so when a serializer gains or renames a field, it has to be
// changed HERE as well or TypeScript will keep cheerfully agreeing with a response
// the server no longer sends. Anything crossing the wire is a plain JSON value:
// dates arrive as ISO-8601 STRINGS, never Date objects.
import type { NoteColor } from "./noteColors";

// A single line of a note's preview, already flattened by the server so a card can
// render it without parsing the document. `checked` applies to task items and
// `ordinal` to numbered-list items; both are absent on every other type.
export type PreviewBlockType = "text" | "heading" | "task" | "bullet" | "ordered" | "quote" | "code";
export interface PreviewBlock {
  type: PreviewBlockType;
  text: string;
  checked?: boolean;
  ordinal?: number;
}

// A note as it appears in a LIST — everything a card needs to draw itself, and
// nothing more. Deliberately excludes the note's document: a list of 50 cards would
// otherwise carry 50 full documents over the wire on every page of results.
export interface NoteCard {
  id: string;
  title: string;
  isLocked: boolean;
  color: NoteColor | null;
  folder: { id: string; name: string } | null;
  tags: { id: string; name: string }[];
  /** Plain-text first line or two, used for search results and the print view. */
  preview: string;
  /** The same preview, split into typed lines (see PreviewBlock). */
  previewBlocks: PreviewBlock[];
  // Bounded real TipTap doc (first few blocks) rendered on cards with the exact
  // detail-page styling. Null for locked/empty notes.
  previewDoc: unknown | null;
  /** True when a locked note actually has ciphertext stored — a locked note with
   *  nothing encrypted would be a corrupt state, and this lets the UI say so. */
  hasEncryptedContent: boolean;
  // Archive and trash are both SOFT states: the row stays in the database with a
  // timestamp, which is what makes "Undo" and "Restore" possible. Null means the
  // note is live. A note in the trash still keeps its folder and its tags.
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// A note as it appears when OPENED — the card's fields plus the document itself.
// Returned only by GET /notes/:id, never by a list.
export interface Note extends NoteCard {
  /** The TipTap/ProseMirror document, as JSON. `unknown` on purpose: only the
   *  editor should interpret its shape, so nothing else is tempted to reach in.
   *  Null for an empty note, and for a LOCKED one — the server redacts it. */
  content: unknown | null;
  /** Present only on a locked note: the parameters needed to derive the key again
   *  from the passphrase. Never a key, and never the passphrase. */
  cryptoMeta: CryptoMeta | null;
}

// Everything needed to re-derive a locked note's key from its passphrase. Stored in
// the clear alongside the ciphertext, which is safe and normal: a salt and an IV are
// not secrets, they only need to be unique. `kdf` is recorded so the format can move
// to Argon2 later without breaking notes locked under PBKDF2.
export interface CryptoMeta {
  kdf: "argon2id" | "pbkdf2";
  salt: string;
  iv: string;
  params?: Record<string, unknown>;
}

// Folders arrive as a TREE, already nested by the server (see buildTree in
// backend/src/routes/folders.ts) — `children` is populated, so the sidebar can
// render straight from it without assembling the hierarchy itself.
export interface Folder {
  id: string;
  name: string;
  color: string | null;
  parentFolderId: string | null;
  children: Folder[];
}

export interface Tag {
  id: string;
  name: string;
  // Number of notes carrying this tag; drives the sidebar's frequency grouping.
  noteCount: number;
}

// One page of a list. `nextCursor` is null when there are no more notes; it is fed
// straight back as the `cursor` query param to fetch the following page.
export interface NotesPage {
  notes: NoteCard[];
  nextCursor: string | null;
}

// A search hit. Carries only enough to render a row in the palette — pick one and
// the full note is fetched separately.
export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
}

// The other end of a note-to-note link, in either direction (links out, and
// backlinks in). `isLocked` is included so the UI can show a padlock instead of
// pretending a locked note's title is readable context.
export interface LinkRef {
  id: string;
  title: string;
  isLocked: boolean;
}
