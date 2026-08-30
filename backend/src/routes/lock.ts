import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { badRequest, notFound } from "../errors.js";
import { lockNoteSchema } from "../schemas.js";
import { emptyDoc } from "../lib/tiptap.js";
import { noteInclude, serializeNote } from "../lib/serialize.js";
import { absorbInlineImages } from "../lib/noteImages.js";
import { detectNoteLanguage } from "../lib/language.js";

// Locked notes — and the deliberate ignorance of this file.
//
// The server performs NO cryptography. Everything is done in the browser: the
// passphrase derives a key there, the note is encrypted there, and only the
// resulting ciphertext is sent here to be stored. The passphrase and the key never
// travel, are never logged, and cannot be recovered from anything in this database.
//
// What is stored alongside the ciphertext is `cryptoMeta` — the salt, the IV and
// the KDF parameters. Those are not secrets: they are the public inputs needed to
// derive the same key again from the same passphrase, and they must be unique
// rather than hidden. Storing them in the clear is normal and correct.
//
// The consequence to keep in mind when editing this file: the server cannot help a
// user who forgets a passphrase, cannot search inside a locked note, and cannot
// export or duplicate one. Those are not missing features — they are the guarantee
// working. If a change here would let the server read a locked note, it is wrong.
//
// Locking also REDACTS the plaintext column, so the readable copy is gone the
// moment the ciphertext lands; unlocking writes it back from what the browser
// decrypted and sent.
//
// IMAGES FOLLOW THE TEXT, and this is the part worth understanding before changing
// anything here. A note's pictures normally live as their own rows of ordinary,
// readable bytes. Leaving them there while the words were encrypted would make the
// lock a half-measure — the screenshot of the thing is usually the thing. So:
//
//   locking    the browser folds every picture into the document as a data URI,
//              encrypts the lot, and sends the ciphertext; THIS FILE then deletes
//              the rows, so nothing readable is left behind.
//   unlocking  the decrypted document comes back with those data URIs still inside,
//              and they are turned back into rows before the note is stored.
//
// The asymmetry is unavoidable: only the browser can do the folding (it happens
// before encryption, with a key the server never sees), and only the server can do
// the unfolding (it happens after decryption, when it is plaintext again).
export async function lockRoutes(app: FastifyInstance) {
  // Lock a note: store ciphertext, redact server-side plaintext, set isLocked.
  app.post("/notes/:id/lock", async (request) => {
    const { id } = request.params as { id: string };
    const body = lockNoteSchema.parse(request.body);
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");
    if (note.isLocked) throw badRequest("Note is already locked");

    const locked = await prisma.$transaction(async (tx) => {
      const updated = await tx.note.update({
        where: { id },
        data: {
          isLocked: true,
          encryptedContent: Buffer.from(body.ciphertext, "base64"),
          cryptoMeta: body.cryptoMeta as Prisma.InputJsonValue,
          // Redact plaintext. The generated tsvector recomputes to empty because
          // isLocked is now true, so the content is no longer searchable.
          content: emptyDoc() as Prisma.InputJsonValue,
        },
        include: noteInclude,
      });
      // Drop the readable picture bytes in the same breath as the readable text.
      // Unconditional, and not dependent on the browser having asked: whatever the
      // client did or forgot to do, a locked note ends up with no plaintext images.
      await tx.noteImage.deleteMany({ where: { noteId: id } });
      return updated;
    });
    return serializeNote(locked);
  });

  // Return the ciphertext + crypto metadata for client-side decryption. There is
  // deliberately no server-side decryption path.
  app.get("/notes/:id/ciphertext", async (request) => {
    const { id } = request.params as { id: string };
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");
    if (!note.isLocked || !note.encryptedContent) throw badRequest("Note is not locked");
    return {
      ciphertext: Buffer.from(note.encryptedContent).toString("base64"),
      cryptoMeta: note.cryptoMeta,
    };
  });

  // Unlock: client sends the decrypted plaintext doc back (having decrypted it
  // locally), which is restored to `content` and the note is un-flagged.
  app.post("/notes/:id/unlock", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { content?: unknown };
    const note = await prisma.note.findFirst({ where: { id, deletedAt: null } });
    if (!note) throw notFound("Note not found");
    if (!note.isLocked) throw badRequest("Note is not locked");
    if (!body?.content || typeof body.content !== "object") {
      throw badRequest("Decrypted content required to unlock");
    }
    const unlocked = await prisma.$transaction(async (tx) => {
      // The decrypted document carries its pictures inline (that is how they were
      // encrypted); turn them back into rows before it is stored, so the note goes
      // back to being an ordinary note in every respect.
      const content = await absorbInlineImages(tx, id, body.content);
      return tx.note.update({
        where: { id },
        data: {
          isLocked: false,
          encryptedContent: null,
          cryptoMeta: Prisma.DbNull,
          content: content as Prisma.InputJsonValue,
          // The plaintext is back, so the note becomes classifiable again — and it
          // has to be classified HERE, because the tsvector regenerates on this same
          // write. Leaving it until the next edit would mean a note that unlocks into
          // French is indexed with English rules until someone happens to touch it.
          contentLanguage: detectNoteLanguage({ title: note.title, content }),
        },
        include: noteInclude,
      });
    });
    return serializeNote(unlocked);
  });
}
