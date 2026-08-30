import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { createTagSchema, updateTagSchema, applyTagSchema } from "../schemas.js";
import { noteInclude, serializeNote } from "../lib/serialize.js";
import { collidesWith } from "../lib/names.js";

// Get-or-create a tag by name. Idempotent so the create-on-the-fly tag input
// (§3.5) never produces duplicates and races resolve to the existing row.
async function getOrCreateTag(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw badRequest("Tag name cannot be empty");
  return prisma.tag.upsert({
    where: { name: trimmed },
    update: {},
    create: { name: trimmed },
  });
}

export async function tagsRoutes(app: FastifyInstance) {
  app.get("/tags", async () => {
    // Include a per-tag note count so the sidebar can group tags by frequency of
    // use. Counts every note-tag link (a handful of trashed notes won't
    // meaningfully skew the "frequently used" grouping) and needs no migration.
    const tags = await prisma.tag.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { notes: true } } },
    });
    return { tags: tags.map(({ _count, ...t }) => ({ ...t, noteCount: _count.notes })) };
  });

  app.post("/tags", async (request, reply) => {
    const body = createTagSchema.parse(request.body);
    const tag = await getOrCreateTag(body.name);
    return reply.status(201).send(tag);
  });

  // Rename a tag. The FIRST way to modify an existing tag's own record — until now a
  // tag could only be created, applied, and deleted once unused, which made a typo
  // permanent in practice: correcting it meant untagging every note, deleting the
  // tag, creating a new one and reapplying it everywhere.
  //
  // A rename touches the tag row and nothing else. Every NoteTag link is keyed on the
  // tag's id, so the associations are untouched by construction — there is no
  // re-tagging step to get wrong, and the notes simply start showing the new name.
  app.patch("/tags/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = updateTagSchema.parse(request.body);
    const name = body.name.trim();
    if (!name) throw badRequest("Tag name cannot be empty");

    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) throw notFound("Tag not found");

    // Checked here as well as in the form, and the duplication is the point. The
    // client's check is a courtesy that makes the collision visible while typing; it
    // cannot be a guarantee, because it reads a snapshot that can be stale by the
    // time the request lands (a second tab, a rename racing a create). This is the
    // one that actually holds the rule.
    //
    // Compared in JS rather than by a query predicate: the rule folds whitespace as
    // well as case, and no Postgres collation does both. See lib/names.ts.
    const others = await prisma.tag.findMany({
      where: { id: { not: id } },
      select: { name: true },
    });
    if (collidesWith(name, others.map((t) => t.name))) {
      throw conflict(`Another tag is already called “${name}”.`);
    }

    return prisma.tag.update({ where: { id }, data: { name } });
  });

  // Apply a tag to a note (by id or by name → get-or-create).
  app.post("/notes/:id/tags", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = applyTagSchema.parse(request.body);
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");

    const tag = body.tagId
      ? await prisma.tag.findUnique({ where: { id: body.tagId } })
      : await getOrCreateTag(body.name!);
    if (!tag) throw badRequest("Tag not found");

    await prisma.noteTag.upsert({
      where: { noteId_tagId: { noteId: id, tagId: tag.id } },
      update: {},
      create: { noteId: id, tagId: tag.id },
    });
    const updated = await prisma.note.findUnique({ where: { id }, include: noteInclude });
    return reply.status(201).send(serializeNote(updated!));
  });

  // Remove a tag from a note.
  app.delete("/notes/:id/tags/:tagId", async (request, reply) => {
    const { id, tagId } = request.params as { id: string; tagId: string };
    await prisma.noteTag.deleteMany({ where: { noteId: id, tagId } });
    return reply.status(204).send();
  });

  // ── Unused-tag cleanup ─────────────────────────────────────────────────────
  //
  // "Unused" means zero note-tag links, counting EVERY note — including archived
  // and trashed ones. A tag whose only notes are in the trash is not unused: those
  // notes can be restored, and they would come back stripped of a tag the user
  // never chose to remove.
  //
  // This is also why the delete REFUSES a tag that is still in use rather than
  // deleting it anyway: NoteTag cascades on tag delete, so an unguarded route
  // would silently untag notes across the library with no undo and no warning.
  // Nothing in the app needs that, so nothing in the app can do it.
  app.delete("/tags/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tag = await prisma.tag.findUnique({
      where: { id },
      include: { _count: { select: { notes: true } } },
    });
    if (!tag) throw notFound("Tag not found");
    if (tag._count.notes > 0) {
      throw conflict(`“${tag.name}” is on ${tag._count.notes} note(s) — only unused tags can be deleted here.`);
    }
    await prisma.tag.delete({ where: { id } });
    return reply.status(204).send();
  });

  // Delete every unused tag in one pass. Deliberately takes no ids: the set is
  // computed at execution time, so "delete all" can only remove tags that are
  // unused at the moment the button is pressed — not the ones that were unused
  // when the dialog opened and have since been applied to something.
  app.post("/tags/cleanup", async (_request, reply) => {
    const result = await prisma.tag.deleteMany({ where: { notes: { none: {} } } });
    return reply.send({ deleted: result.count });
  });
}
