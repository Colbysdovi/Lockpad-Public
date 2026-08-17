import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { badRequest, notFound } from "../errors.js";
import { createLinkSchema } from "../schemas.js";

// Notes pointing at other notes.
//
// A link is an explicit ROW in the database (source → target), created when the
// [[ ]] picker is used or a link is added by hand — it is not inferred by scanning
// note text. That choice is what makes backlinks cheap: "which notes point at this
// one" is an indexed lookup rather than a full-library content search, and it keeps
// working for locked notes, whose text the server cannot read at all.
//
// Both directions are returned together, because a note's incoming links are as
// much a part of its context as its outgoing ones — arguably more, since nobody
// creates them deliberately.
export async function linksRoutes(app: FastifyInstance) {
  app.get("/notes/:id/links", async (request) => {
    const { id } = request.params as { id: string };
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");

    const [outgoing, backlinks] = await Promise.all([
      prisma.noteLink.findMany({
        where: { sourceNoteId: id, target: { deletedAt: null } },
        include: { target: { select: { id: true, title: true, isLocked: true } } },
      }),
      prisma.noteLink.findMany({
        where: { targetNoteId: id, source: { deletedAt: null } },
        include: { source: { select: { id: true, title: true, isLocked: true } } },
      }),
    ]);

    return {
      links: outgoing.map((l) => l.target),
      backlinks: backlinks.map((l) => l.source),
    };
  });

  // Create a link source→target. Idempotent (composite PK). Rejects self-links
  // and links to nonexistent/deleted targets.
  app.post("/notes/:id/links", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = createLinkSchema.parse(request.body);
    if (id === body.targetNoteId) throw badRequest("A note cannot link to itself");

    const [source, target] = await Promise.all([
      prisma.note.findFirst({ where: { id, deletedAt: null } }),
      prisma.note.findFirst({ where: { id: body.targetNoteId, deletedAt: null } }),
    ]);
    if (!source) throw notFound("Source note not found");
    if (!target) throw badRequest("Target note not found");

    await prisma.noteLink.upsert({
      where: { sourceNoteId_targetNoteId: { sourceNoteId: id, targetNoteId: body.targetNoteId } },
      update: {},
      create: { sourceNoteId: id, targetNoteId: body.targetNoteId },
    });
    return reply.status(201).send({ sourceNoteId: id, targetNoteId: body.targetNoteId });
  });

  app.delete("/notes/:id/links/:targetId", async (request, reply) => {
    const { id, targetId } = request.params as { id: string; targetId: string };
    await prisma.noteLink.deleteMany({ where: { sourceNoteId: id, targetNoteId: targetId } });
    return reply.status(204).send();
  });
}
