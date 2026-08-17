// Keeping a note's document and its stored image bytes in step.
//
// An image in a note is TWO things: a row in `NoteImage` holding the bytes, and an
// `image` node in the document whose `src` points at it (`/api/images/<id>`). This
// file owns every operation where those two halves have to move together, so no
// route has to remember the rules on its own:
//
//   absorbInlineImages  a `data:` URI in an incoming document becomes a real row,
//                       and the node is rewritten to point at it
//   cloneImagesForNote  duplicating a note gives the copy its OWN image rows
//   sweepOrphanImages   rows no longer referenced by the document are dropped
//   collectImageIds     which images a document actually uses
//
// WHY `data:` URIs ARE ACCEPTED AT ALL. Normally the editor uploads a file first and
// inserts a node pointing at the resulting row, so a document arriving here already
// references rows that exist. But there are three moments where the bytes can only
// arrive INSIDE the document: unlocking a note (its images were folded into the
// ciphertext when it was locked, and the server cannot open that), importing a file
// that embeds pictures, and restoring a JSON backup. Treating an inline data URI as
// a legitimate input form — normalised on the way in — means those three cases need
// no special path of their own.
//
// The reverse direction (document → data URIs) is deliberately NOT here: that only
// happens when locking, and it has to happen in the browser, because the result is
// encrypted with a key the server never sees.
import type { Prisma, PrismaClient } from "@prisma/client";
import { badRequest } from "../errors.js";
import { config } from "../config.js";

/** A Prisma client or an interactive transaction — every helper accepts either, so
 *  callers can fold image work into a transaction they already opened. */
type Db = PrismaClient | Prisma.TransactionClient;

// The formats a browser can render natively without a decoder or a plugin. SVG is
// deliberately absent: it is a document, not a bitmap — it can carry script and
// remote references, and serving one back to the same origin would hand note content
// a way to run code. Nothing here can execute.
export const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export function isAllowedImageMime(mime: string): mime is AllowedImageMime {
  return (ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime);
}

/** The public path an image is served from, and the shape stored in a document. */
export function imageSrc(id: string): string {
  return `/api/images/${id}`;
}

// The counterpart: pull the id back out of a stored src. Anchored and restricted to
// the id alphabet so a src pointing anywhere else (an external host, a traversal
// attempt) simply does not match and is treated as "not one of ours".
const SRC_PATTERN = /^\/api\/images\/([a-z0-9]+)$/i;

function idFromSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  return SRC_PATTERN.exec(src)?.[1] ?? null;
}

// A `data:` URI carrying an image, split into its mime and its base64 payload.
const DATA_URI_PATTERN = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  [key: string]: unknown;
}

/** Walk a document, replacing nodes as instructed. Returns a NEW tree and leaves the
 *  input untouched — the caller usually still needs the original (to compare against,
 *  or because it belongs to somebody else's object). `visit` returns a replacement
 *  node, or the node it was given to leave it alone. */
function mapNodes(node: unknown, visit: (n: DocNode) => DocNode): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => mapNodes(n, visit));
  const n = node as DocNode;
  const mapped = visit(n);
  if (!Array.isArray(mapped.content)) return mapped;
  return { ...mapped, content: mapped.content.map((c) => mapNodes(c, visit) as DocNode) };
}

/** Every image id a document references, in document order, without duplicates. */
export function collectImageIds(doc: unknown): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as DocNode;
    if (n.type === "image") {
      const id = idFromSrc(n.attrs?.src);
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return ids;
}

/** Does this document carry any inline image data at all? A cheap pre-check so the
 *  common case — an autosave of a document whose images are already rows — costs one
 *  string search instead of a tree rebuild. */
function hasInlineImageData(doc: unknown): boolean {
  return JSON.stringify(doc ?? null).includes("data:image/");
}

/**
 * Turn any inline `data:` image in a document into a real row owned by `noteId`,
 * rewriting each node to point at the row it created. Returns the document to store
 * — the original object, unchanged, when there was nothing inline to absorb.
 *
 * Rejects rather than silently dropping: an image that is too large or of an
 * unsupported type is the user's picture, and quietly losing it while reporting
 * success is the worst possible outcome for a notes app.
 */
export async function absorbInlineImages(db: Db, noteId: string, doc: unknown): Promise<unknown> {
  if (!hasInlineImageData(doc)) return doc;

  // Decode every inline image FIRST, then rewrite the tree. The rewrite itself has
  // to be synchronous (mapNodes cannot await), so the async work is done up front and
  // the results looked up by their original data URI.
  const pending = new Map<string, { mime: string; buffer: Buffer; width: number; height: number }>();
  const collect = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(collect);
    const n = node as DocNode;
    if (n.type === "image" && typeof n.attrs?.src === "string" && n.attrs.src.startsWith("data:")) {
      const src = n.attrs.src;
      if (!pending.has(src)) {
        const match = DATA_URI_PATTERN.exec(src);
        if (!match) throw badRequest("An embedded image could not be read");
        const [, mime, base64] = match;
        if (!isAllowedImageMime(mime.toLowerCase())) {
          throw badRequest(`Unsupported image type: ${mime}`);
        }
        const buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
        if (buffer.length === 0) throw badRequest("An embedded image was empty");
        if (buffer.length > config.maxImageBytes) {
          throw badRequest(`An embedded image is larger than the ${config.maxImageMb}MB limit`);
        }
        pending.set(src, {
          mime: mime.toLowerCase(),
          buffer,
          width: Number(n.attrs.width) || 0,
          height: Number(n.attrs.height) || 0,
        });
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(collect);
  };
  collect(doc);
  if (pending.size === 0) return doc;

  const created = new Map<string, string>(); // data URI → new src
  for (const [src, image] of pending) {
    const row = await db.noteImage.create({
      data: {
        noteId,
        mime: image.mime,
        width: image.width,
        height: image.height,
        size: image.buffer.length,
        // Prisma's Bytes column wants a plain Uint8Array; a Node Buffer is one,
        // but is typed over a wider buffer kind, so it is re-viewed here.
        data: new Uint8Array(image.buffer),
      },
      select: { id: true },
    });
    created.set(src, imageSrc(row.id));
  }

  return mapNodes(doc, (n) => {
    if (n.type !== "image") return n;
    const replacement = typeof n.attrs?.src === "string" ? created.get(n.attrs.src) : undefined;
    return replacement ? { ...n, attrs: { ...n.attrs, src: replacement } } : n;
  });
}

/**
 * Give a duplicated note its own copies of the originals' images, and point the copy's
 * document at them.
 *
 * The rows have to be copied rather than shared. Two notes referencing one row looks
 * harmless right up until either note is deleted — the cascade would take the bytes
 * out from under the note that is still using them, leaving a permanent broken image
 * with no way to tell what it was.
 */
export async function cloneImagesForNote(db: Db, sourceDoc: unknown, newNoteId: string): Promise<unknown> {
  const ids = collectImageIds(sourceDoc);
  if (ids.length === 0) return sourceDoc;

  const originals = await db.noteImage.findMany({ where: { id: { in: ids } } });
  const remap = new Map<string, string>(); // old src → new src
  for (const original of originals) {
    const copy = await db.noteImage.create({
      data: {
        noteId: newNoteId,
        mime: original.mime,
        width: original.width,
        height: original.height,
        size: original.size,
        data: original.data,
      },
      select: { id: true },
    });
    remap.set(imageSrc(original.id), imageSrc(copy.id));
  }

  return mapNodes(sourceDoc, (n) => {
    if (n.type !== "image") return n;
    const next = typeof n.attrs?.src === "string" ? remap.get(n.attrs.src) : undefined;
    return next ? { ...n, attrs: { ...n.attrs, src: next } } : n;
  });
}

/**
 * Rewrite a document's image references using a prepared map of `src` → replacement.
 *
 * Used by the full-library export to turn every `/api/images/<id>` into the picture
 * itself as a data URI, so a backup file is COMPLETE — a backup whose photos are
 * links back into the server it is a backup of would be no backup at all. It takes a
 * ready-made map rather than reading rows itself so the export can load every image
 * in one query instead of one per note.
 *
 * The round trip closes by itself: a document full of data URIs fed back through
 * note creation or import is absorbed by `absorbInlineImages` above, which turns the
 * pictures back into rows.
 */
export function replaceImageSrcs(doc: unknown, replacements: Map<string, string>): unknown {
  if (replacements.size === 0) return doc;
  return mapNodes(doc, (n) => {
    if (n.type !== "image") return n;
    const next = typeof n.attrs?.src === "string" ? replacements.get(n.attrs.src) : undefined;
    return next ? { ...n, attrs: { ...n.attrs, src: next } } : n;
  });
}

// How long an unreferenced image is kept before the sweep takes it.
//
// It is NOT swept immediately, and the delay is the whole point: deleting an image
// from a note is undoable (the editor keeps a real undo history, and it survives
// closing and reopening the note — see frontend/src/lib/editorSession.ts). Reclaiming
// the bytes the instant the node leaves the document would turn a reversible edit
// into an irreversible one, and the user would press undo to find a broken picture.
// A day is far longer than any undo history, which only lives as long as the tab.
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** Drop this note's images that the document no longer references and that are past
 *  the undo grace period. Cheap enough to run on every save: one indexed delete. */
export async function sweepOrphanImages(db: Db, noteId: string, doc: unknown): Promise<void> {
  const keep = collectImageIds(doc);
  await db.noteImage.deleteMany({
    where: {
      noteId,
      ...(keep.length ? { id: { notIn: keep } } : {}),
      createdAt: { lt: new Date(Date.now() - ORPHAN_GRACE_MS) },
    },
  });
}
