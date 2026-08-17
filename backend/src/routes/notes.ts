import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { badRequest, notFound } from "../errors.js";
import { createNoteSchema, updateNoteSchema, listNotesQuery, bulkActionSchema } from "../schemas.js";
import { emptyDoc } from "../lib/tiptap.js";
import { noteInclude, serializeNote, serializeNoteCard } from "../lib/serialize.js";
import { absorbInlineImages, cloneImagesForNote, sweepOrphanImages } from "../lib/noteImages.js";

// Notes: the core of the API — creating, reading, listing and editing them, plus
// duplicate and the bulk actions the multi-select bar uses.
//
// ONE TABLE, THREE PILES. Archive and trash are not separate collections: they are
// timestamps on the note itself (`archivedAt`, `deletedAt`). A note in the trash
// keeps its row, its folder, its tags and its links, which is exactly what makes
// Restore possible and why "Undo" after a delete costs nothing. `listWhere` below
// is what turns those timestamps into the three views.

// Which pile a list is asking for. Note that trash beats archive: a note that was
// archived and then deleted belongs in the trash, and should not also appear in the
// archive — otherwise deleting from the archive would look like it did nothing.
function listWhere(filter: "active" | "trash" | "archive"): Prisma.NoteWhereInput {
  if (filter === "trash") return { deletedAt: { not: null } };
  if (filter === "archive") return { deletedAt: null, archivedAt: { not: null } };
  return { deletedAt: null, archivedAt: null };
}

export async function notesRoutes(app: FastifyInstance) {
  // ── List ──────────────────────────────────────────────────────────────────
  //
  // Most-recently-edited first, which is what makes the app feel like a desk rather
  // than a filing cabinet: whatever you last touched is where you left it, on top.
  //
  // Paginated by CURSOR, not by offset. An offset ("skip 50") is unstable when the
  // list changes underneath the reader — editing a note moves it to the top, and
  // every subsequent page then repeats or skips a note. A cursor names the exact
  // position to continue from (updatedAt + id, the id breaking ties between notes
  // saved in the same millisecond), so pages stay consistent while you scroll.
  app.get("/notes", async (request) => {
    const q = listNotesQuery.parse(request.query);
    const where: Prisma.NoteWhereInput = {
      ...listWhere(q.filter),
      ...(q.folderId ? { folderId: q.folderId } : {}),
      ...(q.tagId ? { tags: { some: { tagId: q.tagId } } } : {}),
      // Notes pinned in the current page's scope are shown in the Pinned section,
      // so exclude them here to avoid rendering the same note twice.
      ...(q.scope ? { pins: { none: { scope: q.scope } } } : {}),
    };

    const notes = await prisma.note.findMany({
      where,
      include: noteInclude,
      // Newest-touched first. `createdAt` breaks exact `updatedAt` ties so a freshly
      // created note always sorts ahead of same-instant siblings (cuid `id`s are not
      // creation-ordered, so `id` alone was a non-deterministic tiebreak); `id` stays
      // last as the unique, stable cursor key for pagination.
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1, // fetch one extra to know if there's a next page
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = notes.length > q.limit;
    const page = hasMore ? notes.slice(0, q.limit) : notes;
    return {
      notes: page.map(serializeNoteCard),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  });

  // ── Create (honors optional folderId + tagIds) ─────────────────────────────
  app.post("/notes", async (request, reply) => {
    const body = createNoteSchema.parse(request.body);

    if (body.folderId) {
      const folder = await prisma.folder.findUnique({ where: { id: body.folderId } });
      if (!folder) throw badRequest("folderId does not exist");
    }

    // A document can arrive with pictures embedded in it (an import, a restored
    // backup). They can only become rows once the note exists to own them, so the
    // note is created first and its content rewritten in the same transaction —
    // never leaving a half-absorbed document visible to a concurrent read.
    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          title: body.title,
          content: (body.content ?? emptyDoc()) as Prisma.InputJsonValue,
          folderId: body.folderId ?? null,
          color: body.color ?? null,
          ...(body.tagIds?.length
            ? { tags: { create: body.tagIds.map((tagId) => ({ tagId })) } }
            : {}),
        },
        include: noteInclude,
      });
      const absorbed = await absorbInlineImages(tx, created.id, created.content);
      if (absorbed === created.content) return created;
      return tx.note.update({
        where: { id: created.id },
        data: { content: absorbed as Prisma.InputJsonValue },
        include: noteInclude,
      });
    });
    return reply.status(201).send(serializeNote(note));
  });

  // ── Read one ───────────────────────────────────────────────────────────────
  app.get("/notes/:id", async (request) => {
    const { id } = request.params as { id: string };
    const note = await prisma.note.findFirst({
      where: { id, deletedAt: null },
      include: noteInclude,
    });
    if (!note) throw notFound("Note not found");
    return serializeNote(note);
  });

  // ── Update (title/content/folder; ignores unknown fields via strict schema) ─
  app.patch("/notes/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = updateNoteSchema.parse(request.body);

    const existing = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw notFound("Note not found");
    // A locked note's plaintext content lives only client-side; block content writes.
    if (existing.isLocked && body.content !== undefined) {
      throw badRequest("Cannot patch content of a locked note; unlock first");
    }
    if (body.folderId) {
      const folder = await prisma.folder.findUnique({ where: { id: body.folderId } });
      if (!folder) throw badRequest("folderId does not exist");
    }

    // Content edits carry two image chores: take in anything embedded inline (rare
    // — normally the editor uploads first), and let go of rows the document has
    // stopped referencing. Both are no-ops for a save that didn't touch content,
    // and the sweep deliberately spares recent images so undo still works — see
    // lib/noteImages.ts.
    const content =
      body.content !== undefined ? await absorbInlineImages(prisma, id, body.content) : undefined;

    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(content !== undefined ? { content: content as Prisma.InputJsonValue } : {}),
        ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
        // Color is note metadata (not content), so it's editable even when locked.
        ...(body.color !== undefined ? { color: body.color } : {}),
      },
      include: noteInclude,
    });
    if (content !== undefined) await sweepOrphanImages(prisma, id, content);
    return serializeNote(note);
  });

  // ── Duplicate ──────────────────────────────────────────────────────────────
  // Copies title (+" (copy)"), content, folder and tags into a fresh ACTIVE note
  // (never archived/deleted). Locked notes are refused — their plaintext content
  // lives only client-side, so the server has nothing to copy.
  app.post("/notes/:id/duplicate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const src = await prisma.note.findFirst({ where: { id, deletedAt: null }, include: noteInclude });
    if (!src) throw notFound("Note not found");
    if (src.isLocked) throw badRequest("Cannot duplicate a locked note; unlock it first");

    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          title: `${src.title} (copy)`,
          content: src.content as Prisma.InputJsonValue,
          color: src.color,
          folderId: src.folderId,
          ...(src.tags.length ? { tags: { create: src.tags.map((t) => ({ tagId: t.tagId })) } } : {}),
        },
        include: noteInclude,
      });
      // The copy gets its OWN picture rows rather than pointing at the original's:
      // sharing them means deleting either note would break the image in the other.
      const content = await cloneImagesForNote(tx, created.content, created.id);
      if (content === created.content) return created;
      return tx.note.update({
        where: { id: created.id },
        data: { content: content as Prisma.InputJsonValue },
        include: noteInclude,
      });
    });
    return reply.status(201).send(serializeNote(copy));
  });

  // ── Bulk actions (multi-select) ────────────────────────────────────────────
  // Applies one action to many notes atomically (all-or-nothing via a
  // transaction). Static path — declared alongside the other /notes routes.
  app.post("/notes/bulk", async (request) => {
    const body = bulkActionSchema.parse(request.body);
    const { action, ids } = body;

    const count = await prisma.$transaction(async (tx) => {
      switch (action) {
        case "archive":
          return (await tx.note.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { archivedAt: new Date() } })).count;
        case "unarchive":
          return (await tx.note.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { archivedAt: null } })).count;
        case "delete":
          return (await tx.note.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } })).count;
        case "restore":
          return (await tx.note.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } })).count;
        case "move":
          return (await tx.note.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { folderId: body.folderId ?? null } })).count;
        case "tag":
          await tx.noteTag.createMany({ data: ids.map((noteId) => ({ noteId, tagId: body.tagId! })), skipDuplicates: true });
          return ids.length;
        case "color":
          // `color` may be a preset key or null (clear). Applies to non-deleted notes.
          return (await tx.note.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { color: body.color ?? null } })).count;
      }
    });

    return { count };
  });
}
