// What the API will accept, as Zod schemas.
//
// Every route parses its input through one of these before touching the database,
// so a handler can trust the shape of what it received. A parse failure is turned
// into a 400 with the field-level details by the error handler in app.ts — routes
// never have to check for missing or malformed fields themselves.
//
// These are the API's contract with the client, and the counterpart to
// frontend/src/lib/types.ts on the way back out.
import { z } from "zod";

// A note's document is arbitrary TipTap/ProseMirror JSON and its shape is the
// EDITOR's business, not the server's — so this validates only that it is an
// object. Pinning down the node types here would mean this file needing a change
// every time the editor gains an extension, for no safety the editor doesn't
// already provide.
export const tiptapDoc = z.record(z.string(), z.unknown());

// The fixed set of note-color keys (order mirrors the frontend palette in
// lib/noteColors.ts). A note's `color` is one of these or null ("no color").
export const NOTE_COLOR_KEYS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
  "slate",
] as const;
export const noteColor = z.enum(NOTE_COLOR_KEYS);

export const createNoteSchema = z.object({
  title: z.string().max(500).optional().default("Untitled"),
  content: tiptapDoc.optional(),
  folderId: z.string().cuid().nullish(),
  tagIds: z.array(z.string().cuid()).optional(),
  // Assign a preset color at creation, or null/omit for "no color".
  color: noteColor.nullable().optional(),
});

export const updateNoteSchema = z
  .object({
    title: z.string().max(500).optional(),
    content: tiptapDoc.optional(),
    folderId: z.string().cuid().nullable().optional(),
    // Assign a preset color, or null to clear it ("no color").
    color: noteColor.nullable().optional(),
  })
  .strict();

// A per-page pin scope: "all", "folder:<id>", or "tag:<id>".
export const pinScope = z.string().regex(/^(all|(folder|tag):[a-z0-9]+)$/i, "Invalid scope");
export const pinScopeQuery = z.object({ scope: pinScope });
export const pinBody = z.object({ scope: pinScope });

// Bulk operation over a set of notes (multi-select). Applied atomically.
export const bulkActionSchema = z
  .object({
    action: z.enum(["archive", "unarchive", "delete", "restore", "move", "tag", "color"]),
    ids: z.array(z.string().cuid()).min(1).max(500),
    folderId: z.string().cuid().nullable().optional(),
    tagId: z.string().cuid().optional(),
    // For the "color" action: a preset key, or null to clear ("no color").
    color: noteColor.nullable().optional(),
  })
  .refine((v) => v.action !== "tag" || !!v.tagId, { message: "tagId required for the tag action" });

export const listNotesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  folderId: z.string().cuid().optional(),
  tagId: z.string().cuid().optional(),
  filter: z.enum(["active", "trash", "archive"]).optional().default("active"),
  // When set, exclude notes pinned in this scope (they render in the Pinned
  // section instead, so they don't appear twice).
  scope: pinScope.optional(),
});

// Accepts a hex color like #abc or #aabbcc (nullable to clear).
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex color");

export const createFolderSchema = z.object({
  name: z.string().min(1).max(200),
  color: hexColor.nullish(),
  parentFolderId: z.string().cuid().nullish(),
});

export const updateFolderSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    color: hexColor.nullable().optional(),
    parentFolderId: z.string().cuid().nullable().optional(),
  })
  .strict();

export const createTagSchema = z.object({
  name: z.string().min(1).max(100),
});

export const applyTagSchema = z.object({
  tagId: z.string().cuid().optional(),
  name: z.string().min(1).max(100).optional(),
}).refine((v) => v.tagId || v.name, { message: "tagId or name required" });

export const createLinkSchema = z.object({
  targetNoteId: z.string().cuid(),
});

export const searchQuery = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

// Title lookup for note pickers. Separate from searchQuery on purpose — see the
// note above the /notes/lookup route for why a picker cannot use full-text search.
// Smaller default limit: this feeds a dropdown, not a results page.
export const lookupQuery = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export const lockNoteSchema = z.object({
  // Base64-encoded AES-GCM ciphertext produced client-side.
  ciphertext: z.string().min(1),
  // KDF params + salt + iv the client needs to re-derive & decrypt. No key/plaintext.
  cryptoMeta: z.object({
    kdf: z.enum(["argon2id", "pbkdf2"]),
    salt: z.string(),
    iv: z.string(),
    // Argon2 params or PBKDF2 iterations, etc.
    params: z.record(z.string(), z.unknown()).optional(),
  }),
});
