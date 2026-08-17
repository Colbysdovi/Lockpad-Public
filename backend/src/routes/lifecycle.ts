import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { notFound } from "../errors.js";
import { noteInclude, serializeNote } from "../lib/serialize.js";

// Putting notes away, and getting them back.
//
// Every route here is REVERSIBLE except the last one. Archiving and trashing only
// write a timestamp — the note, its folder, its tags and its links all stay exactly
// as they were — so restoring is simply clearing that timestamp, and nothing has to
// be reconstructed. That is what allows the app to offer "Undo" on a toast and mean
// it, and why deleting forty notes at once is not a frightening operation.
//
// `DELETE /notes/:id/permanent` is the exception and the only route in the app that
// destroys data. It is reachable from one place in the UI (the trash), behind a
// confirmation, precisely because there is no coming back from it.
//
// The trash and archive LISTS are not here — they are the notes list endpoint with
// ?filter=trash or ?filter=archive, since they are views of the same table.
export async function lifecycleRoutes(app: FastifyInstance) {
  // Soft delete → sets deletedAt.
  app.delete("/notes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");
    await prisma.note.update({ where: { id }, data: { deletedAt: new Date() } });
    return reply.status(204).send();
  });

  // Restore from trash.
  app.post("/notes/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) throw notFound("Note not found");
    const restored = await prisma.note.update({
      where: { id },
      data: { deletedAt: null },
      include: noteInclude,
    });
    return serializeNote(restored);
  });

  // Empty the trash: permanently delete every soft-deleted note. Cascades remove
  // their NoteTag/NoteLink rows. Returns the count removed.
  app.delete("/notes/trash/empty", async (_request, reply) => {
    const result = await prisma.note.deleteMany({ where: { deletedAt: { not: null } } });
    return reply.status(200).send({ deleted: result.count });
  });

  // Permanent delete (from trash). Cascades remove NoteTag/NoteLink rows.
  app.delete("/notes/:id/permanent", async (request, reply) => {
    const { id } = request.params as { id: string };
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) throw notFound("Note not found");
    await prisma.note.delete({ where: { id } });
    return reply.status(204).send();
  });

  // Archive / unarchive.
  app.post("/notes/:id/archive", async (request) => {
    const { id } = request.params as { id: string };
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");
    const updated = await prisma.note.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: noteInclude,
    });
    return serializeNote(updated);
  });

  app.post("/notes/:id/unarchive", async (request) => {
    const { id } = request.params as { id: string };
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");
    const updated = await prisma.note.update({
      where: { id },
      data: { archivedAt: null },
      include: noteInclude,
    });
    return serializeNote(updated);
  });
}
