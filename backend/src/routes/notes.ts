import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { badRequest, notFound } from "../errors.js";
import { createNoteSchema, updateNoteSchema, listNotesQuery, bulkActionSchema } from "../schemas.js";
import { emptyDoc } from "../lib/tiptap.js";
import { detectNoteLanguage } from "../lib/language.js";
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
      const content = (body.content ?? emptyDoc()) as Prisma.InputJsonValue;
      const created = await tx.note.create({
        data: {
          title: body.title,
          content,
          // Detected here, in the same statement that writes the text it was
          // detected from. That ordering is the whole reliability guarantee: the
          // tsvector column is GENERATED from this column, so index and language are
          // computed from one row state and cannot disagree — not across concurrent
          // edits, and not if the request fails halfway, because a failed INSERT
          // writes neither.
          contentLanguage: detectNoteLanguage({ title: body.title, content }),
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
        data: {
          content: absorbed as Prisma.InputJsonValue,
          // Re-detected because this writes DIFFERENT content from the insert above.
          // Absorbing inline images rewrites the document, and a language decided
          // from the pre-absorption text would describe a version of the note that no
          // longer exists. Every statement that writes content sets the language in
          // the same statement, without exception — the exception is where the two
          // drift apart.
          contentLanguage: detectNoteLanguage({ title: created.title, content: absorbed }),
        },
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

    // Re-detected on every edit that changes the text, never frozen at creation
    // time (PRD §7). A note rewritten from English into French must move to French
    // indexing, and the existing search column already regenerates on every write —
    // this simply keeps the language it depends on regenerating with it.
    //
    // It is skipped only when neither the title nor the content changed, because
    // then there is no new text to classify. Detection reads BOTH, so a title-only
    // edit still re-runs it: renaming "Notes" to "Réunion d'équipe hebdomadaire" is
    // exactly the case where a note becomes classifiable for the first time.
    const textChanged = body.title !== undefined || content !== undefined;
    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(content !== undefined ? { content: content as Prisma.InputJsonValue } : {}),
        ...(textChanged && !existing.isLocked
          ? {
              contentLanguage: detectNoteLanguage({
                title: body.title !== undefined ? body.title : existing.title,
                content: content !== undefined ? content : existing.content,
              }),
            }
          : {}),
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
  // Copies title (+" (copy)"), content, folder, tags AND pins into a fresh ACTIVE
  // note (never archived/deleted). Locked notes are refused — their plaintext
  // content lives only client-side, so the server has nothing to copy.
  app.post("/notes/:id/duplicate", async (request, reply) => {
    const { id } = request.params as { id: string };
    // `pins` on top of the usual card includes: the copy inherits them (see below),
    // so the duplicate needs to know which scopes the original was pinned in.
    const src = await prisma.note.findFirst({
      where: { id, deletedAt: null },
      include: { ...noteInclude, pins: true },
    });
    if (!src) throw notFound("Note not found");
    if (src.isLocked) throw badRequest("Cannot duplicate a locked note; unlock it first");

    // The copy INHERITS the original's `updatedAt`, and this is the whole reason it
    // lands where it does.
    //
    // A fresh timestamp would sort the copy to the very top of the list — the far
    // top-left of the grid — which is nowhere near the note it came from. Duplicate a
    // note near the bottom of a long list and the copy is created off-screen: the
    // user is told something happened and shown nothing, and has to go hunting for a
    // note they did not move.
    //
    // Inheriting it is also the more honest value. `updatedAt` means "when this text
    // last changed", and nobody has written a word: the copy's content is exactly as
    // old as the original's. The moment the user actually edits the copy, Prisma's
    // `@updatedAt` bumps it and the note rises to the top like anything else — which
    // is the correct behaviour, because by then it genuinely is the most recent thing
    // they touched.
    //
    // `createdAt` is deliberately NOT inherited, and that is load-bearing rather than
    // an oversight. The list sorts by `[updatedAt desc, createdAt desc, id desc]`, so
    // with `updatedAt` tied the copy's newer `createdAt` breaks the tie in its favour
    // and it sorts immediately AHEAD of its original — the slot directly to its left.
    // Inheriting both would tie those two as well and leave the order to `id`, and
    // cuids are not creation-ordered, so which of the pair came first would be
    // effectively random. The row really was created now, so this is true as well as
    // useful.
    //
    // PINS are inherited the same way, and for the same reason. A duplicate is meant
    // to be a copy of the note as the user has it — if they pinned it, the copy is
    // pinned too, in every scope the original was pinned in (a note can be pinned in
    // "all", in a folder and under a tag independently, so this is a list, not a
    // flag). Without this the copy of a pinned note vanishes out of the Pinned
    // section it was made in and reappears somewhere down the main list, which reads
    // as the app having moved it rather than copied it.
    //
    // `pinnedAt` is inherited for exactly the reason `updatedAt` is: the Pinned
    // section sorts on it, so stamping the copy with the current time would fire it
    // to the front of the pinned row instead of leaving it beside its original. With
    // it tied, the tiebreak is the note's own `createdAt` (see the pins query), which
    // is fresh on the copy — so it sorts immediately ahead of its original there,
    // matching the main list exactly.
    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          title: `${src.title} (copy)`,
          content: src.content as Prisma.InputJsonValue,
          // Detected rather than copied from the original. The two will agree in
          // every ordinary case, since the text is the same — but copying would make
          // this the one write path whose language came from somewhere other than the
          // text it is storing, and that is the kind of exception that is correct
          // until the day something upstream changes.
          contentLanguage: detectNoteLanguage({
            title: src.title,
            content: src.content,
            isLocked: src.isLocked,
          }),
          color: src.color,
          folderId: src.folderId,
          updatedAt: src.updatedAt,
          ...(src.tags.length ? { tags: { create: src.tags.map((t) => ({ tagId: t.tagId })) } } : {}),
          ...(src.pins.length
            ? { pins: { create: src.pins.map((p) => ({ scope: p.scope, pinnedAt: p.pinnedAt })) } }
            : {}),
        },
        include: noteInclude,
      });
      // The copy gets its OWN picture rows rather than pointing at the original's:
      // sharing them means deleting either note would break the image in the other.
      const content = await cloneImagesForNote(tx, created.content, created.id);
      if (content === created.content) return created;
      // Re-state the inherited timestamp. `@updatedAt` fires on every update, so
      // without this the image rewrite above would silently stamp the copy with the
      // current time and send it to the top of the list — meaning a note containing
      // pictures would land somewhere completely different from one without, for a
      // reason no user could ever guess.
      return tx.note.update({
        where: { id: created.id },
        data: { content: content as Prisma.InputJsonValue, updatedAt: src.updatedAt },
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
