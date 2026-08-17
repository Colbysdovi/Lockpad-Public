import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { badRequest, notFound } from "../errors.js";
import { config } from "../config.js";
import { isAllowedImageMime, ALLOWED_IMAGE_MIMES } from "../lib/noteImages.js";

// Storing and serving the pictures inside notes.
//
// Three endpoints and one rule: THE BYTES NEVER LEAVE THIS SERVER AND NOTHING ELSE
// EVER PUT THEM HERE. An image is uploaded by the browser that is editing a note,
// kept in that note's row, and served back to the same origin. Nothing is fetched
// from a third party, nothing is resized or analysed by a service, and no URL in a
// note ever points anywhere but here — which is what keeps a note with a photo in it
// as private as a note without one.
//
// Uploads are refused for a LOCKED note. A locked note's document lives only as
// ciphertext, so an image accepted for it would be a plaintext picture belonging to a
// note whose text is unreadable — precisely the gap locking exists to close. The
// editor never offers the action, and this is the check that makes it true.
export async function imagesRoutes(app: FastifyInstance) {
  // ── Upload ─────────────────────────────────────────────────────────────────
  //
  // Multipart, one file per request. `width`/`height` come along as ordinary form
  // fields because the browser has already decoded the image (it downscales before
  // uploading) and therefore knows them — reading them again here would mean a
  // server-side image decoder for two numbers used only to reserve layout space.
  app.post("/notes/:id/images", async (request, reply) => {
    const { id } = request.params as { id: string };

    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");
    if (note.isLocked) throw badRequest("Unlock this note before adding an image");

    const file = await (request as any).file();
    if (!file) throw badRequest("No image was uploaded");

    const mime = String(file.mimetype ?? "").toLowerCase();
    if (!isAllowedImageMime(mime)) {
      throw badRequest(`Images must be one of: ${ALLOWED_IMAGE_MIMES.join(", ")}`);
    }

    const buffer = new Uint8Array(await file.toBuffer());
    if (buffer.length === 0) throw badRequest("That image file was empty");
    // @fastify/multipart also enforces a limit and sets `truncated` when it trips;
    // check both, because the two limits are configured independently and the
    // truncated flag is the only signal for a file that was cut off mid-stream.
    if (file.file?.truncated || buffer.length > config.maxImageBytes) {
      throw badRequest(`Images must be ${config.maxImageMb}MB or smaller`);
    }

    // Form fields arrive as { value } wrappers alongside the file part.
    const fields = (file.fields ?? {}) as Record<string, { value?: unknown } | undefined>;
    const dimension = (name: string) => {
      const raw = Number(fields[name]?.value);
      return Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 100000) : 0;
    };

    const image = await prisma.noteImage.create({
      data: {
        noteId: id,
        mime,
        width: dimension("width"),
        height: dimension("height"),
        size: buffer.length,
        data: buffer,
      },
      select: { id: true, mime: true, width: true, height: true, size: true },
    });

    // `src` is returned ready to drop straight into the document, so the editor never
    // has to know how an image URL is spelled.
    return reply.status(201).send({ ...image, src: `/api/images/${image.id}` });
  });

  // ── Serve ──────────────────────────────────────────────────────────────────
  //
  // Behind the same session guard as every other /api route (see app.ts), so an
  // image is exactly as reachable as the note containing it — no unguessable-URL
  // pretence, no separate sharing model.
  app.get("/images/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const image = await prisma.noteImage.findUnique({
      where: { id },
      include: { note: { select: { isLocked: true } } },
    });
    if (!image) throw notFound("Image not found");
    // Belt and braces: locking deletes a note's image rows, so this should be
    // unreachable. It stays because it is the last line between a locked note and a
    // readable picture, and a future change that forgets the deletion should fail
    // closed rather than quietly serve one.
    if (image.note.isLocked) throw notFound("Image not found");

    return reply
      .header("Content-Type", image.mime)
      // An image is immutable: an edit produces a new row with a new id, never new
      // bytes under an old one. So it can be cached hard and forever — which is what
      // stops a note full of photos re-downloading them on every open. `private`
      // keeps it out of any shared proxy cache in front of the server.
      .header("Cache-Control", "private, max-age=31536000, immutable")
      // Serve it as exactly the type recorded and nothing else; never let a browser
      // sniff its way to a different (scriptable) interpretation of these bytes.
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", "inline")
      .send(image.data);
  });

  // ── Delete ─────────────────────────────────────────────────────────────────
  //
  // Used by the browser when it folds a note's images into the note's ciphertext at
  // lock time. Ordinary editing does NOT call this — removing an image from a note is
  // undoable, so those rows are left for the delayed sweep in lib/noteImages.ts.
  app.delete("/images/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const image = await prisma.noteImage.findUnique({ where: { id }, select: { id: true } });
    if (!image) throw notFound("Image not found");
    await prisma.noteImage.delete({ where: { id } });
    return reply.status(204).send();
  });
}
