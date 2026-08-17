import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { notFound } from "../errors.js";
import { pinScopeQuery, pinBody } from "../schemas.js";
import { noteInclude, serializeNoteCard } from "../lib/serialize.js";

// Pinning a note to the top of a list.
//
// Pins are PER PAGE, not global — that is the whole design. A pin is a (noteId,
// scope) pair, where scope is "all", "folder:<id>" or "tag:<id>", so the same note
// can be pinned on its folder page without cluttering All notes, and a note pinned
// on All notes does not force itself to the top of every tag it happens to carry.
// Each list is allowed its own idea of what matters.
//
// Only active notes can be pinned; archiving or trashing a note takes it out of the
// pinned section along with everything else.
//
// A pinned note appears ONCE: the pinned section renders it, and the ordinary list
// below excludes anything pinned in the current scope (see the ?scope= handling in
// the notes list route). Change one of those without the other and notes start
// appearing twice.
export async function pinsRoutes(app: FastifyInstance) {
  // Pinned notes for a scope, most-recently-pinned first. Static path — declared
  // before the parameterised /notes/:id route wins in Fastify's radix router.
  app.get("/notes/pins", async (request) => {
    const { scope } = pinScopeQuery.parse(request.query);
    const pins = await prisma.pinnedNote.findMany({
      where: { scope, note: { deletedAt: null, archivedAt: null } },
      orderBy: { pinnedAt: "desc" },
      include: { note: { include: noteInclude } },
    });
    return { notes: pins.map((p) => serializeNoteCard(p.note)) };
  });

  // Pin a note to a scope. Idempotent: re-pinning keeps the original pinnedAt.
  app.post("/notes/:id/pin", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { scope } = pinBody.parse(request.body);
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");
    await prisma.pinnedNote.upsert({
      where: { noteId_scope: { noteId: id, scope } },
      create: { noteId: id, scope },
      update: {},
    });
    return reply.status(204).send();
  });

  // Unpin a note from a scope.
  app.delete("/notes/:id/pin", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { scope } = pinScopeQuery.parse(request.query);
    await prisma.pinnedNote.deleteMany({ where: { noteId: id, scope } });
    return reply.status(204).send();
  });
}
