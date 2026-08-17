import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { imageSrc, replaceImageSrcs } from "../lib/noteImages.js";

// Full-library JSON export (export PRD, batch scope). One versioned file describing
// the entire library's state at export time — every note across ALL lifecycle states
// (active, archived, trashed) plus folders, tags and note-links — designed as a real,
// future-proof backup.
//
// Future-proofing: each note's `content` is the TipTap/ProseMirror document as
// stored. Because that model is an extensible node tree, new block types added to
// the editor later (dividers, tables, …) are already representable here without any
// change to THIS format — only the version bumps if the envelope itself ever changes.
//
// IMAGES ARE EMBEDDED, not referenced. A note's pictures live in their own table and
// its document only points at them (`/api/images/<id>`); written out that way, this
// file would be a backup whose photographs are links back into the very server it is
// a backup of — useless on any other machine, and useless after the disaster it
// exists for. So each reference is swapped for the picture itself as a data URI.
// Importing the file reverses this automatically: note creation absorbs embedded
// images back into rows (see lib/noteImages.ts), so a full round trip needs no
// special handling at either end.
//
// The cost is size and memory: base64 is a third larger than the bytes it encodes,
// and the whole payload is assembled in memory before it is sent. For a personal
// library — where the browser downscales anything it uploads and a single image is
// capped at MAX_IMAGE_MB — that is a comfortable trade for a backup that actually
// restores. A library with thousands of photographs would want a streaming format
// instead, and `counts.imageBytes` below is there to make that moment visible before
// it becomes a problem.
//
// Locked notes are excluded (their plaintext lives only client-side; the server has
// nothing to export). They never block the export — it completes for everything else,
// and the omitted notes are listed by title in `skippedLocked` so the user knows what
// wasn't captured. Built in memory and streamed as the response — no temp files.

// Bump only when the envelope shape changes — NOT when new note block types appear
// (those ride along inside `content` untouched, which is the whole point).
const EXPORT_FORMAT_VERSION = 1;

export async function exportRoutes(app: FastifyInstance) {
  app.get("/export", async () => {
    const [notes, folders, tags, noteLinks, images] = await Promise.all([
      prisma.note.findMany({ include: { tags: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.folder.findMany({ orderBy: { name: "asc" } }),
      prisma.tag.findMany({ orderBy: { name: "asc" } }),
      prisma.noteLink.findMany(),
      // Every image in one query, rather than one query per note: a library of a
      // hundred illustrated notes should not cost a hundred round trips.
      prisma.noteImage.findMany(),
    ]);

    // src → the picture itself. Built once and applied to every note below.
    let imageBytes = 0;
    const inlineImages = new Map<string, string>();
    for (const image of images) {
      imageBytes += image.size;
      inlineImages.set(imageSrc(image.id), `data:${image.mime};base64,${Buffer.from(image.data).toString("base64")}`);
    }

    // Split locked notes out — excluded from the payload, surfaced in the manifest.
    const skippedLocked: { id: string; title: string }[] = [];
    const exportedNotes = [];
    for (const n of notes) {
      if (n.isLocked) {
        skippedLocked.push({ id: n.id, title: n.title });
        continue;
      }
      exportedNotes.push({
        id: n.id,
        title: n.title,
        // The document as stored, except that its images are carried inline so this
        // file stands on its own. See the note at the top of the file.
        content: replaceImageSrcs(n.content, inlineImages),
        color: n.color,
        folderId: n.folderId,
        tagIds: n.tags.map((t) => t.tagId),
        // Lifecycle metadata so a future restore can place each note in the right
        // bucket (active / archived / trashed).
        archivedAt: n.archivedAt?.toISOString() ?? null,
        deletedAt: n.deletedAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      });
    }

    return {
      exportFormatVersion: EXPORT_FORMAT_VERSION,
      app: "lockpad",
      exportedAt: new Date().toISOString(),
      counts: {
        notes: exportedNotes.length,
        folders: folders.length,
        tags: tags.length,
        noteLinks: noteLinks.length,
        skippedLocked: skippedLocked.length,
        images: images.length,
        // The size of the pictures before base64 expands them by a third. Worth
        // watching: it is the number that decides whether this format still fits.
        imageBytes,
      },
      // Notes omitted because they were locked at export time — unlock and re-run,
      // or export them individually, to capture their contents.
      skippedLocked,
      notes: exportedNotes,
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        color: f.color,
        parentFolderId: f.parentFolderId,
      })),
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      // Backlinks/relations between notes, so a future import can reconstruct them.
      noteLinks: noteLinks.map((l) => ({ sourceNoteId: l.sourceNoteId, targetNoteId: l.targetNoteId })),
    };
  });
}
