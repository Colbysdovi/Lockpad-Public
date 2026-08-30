import type { FastifyInstance } from "fastify";
import type { Prisma, Folder } from "@prisma/client";
import { prisma } from "../prisma.js";
import { badRequest } from "../errors.js";
import { parseCsvFile, parseTextFile, parseHtmlFile, parseJsonFile, type ParsedNote } from "../lib/import.js";
import { makePreview } from "../lib/tiptap.js";
import { noteInclude, serializeNote } from "../lib/serialize.js";
import { absorbInlineImages } from "../lib/noteImages.js";
import { detectNoteLanguage } from "../lib/language.js";

// Bringing notes in from other apps.
//
// TWO ENDPOINTS, one job. `/import/preview` parses the uploaded files and returns
// what WOULD be created without writing anything; `/import/commit` parses the same
// files again and actually creates the notes. The files are therefore uploaded
// twice, which is deliberate: the server keeps no half-finished import state between
// the two steps, so a user who changes their mind leaves nothing behind on disk or
// in the database.
//
// Import is the one action that can add hundreds of notes at once and has no bulk
// undo, which is why it is worth showing the result before doing it.
//
// NOTHING LEAVES THIS SERVER. Parsing works on the uploaded bytes alone — no
// lookups, no enrichment, no fetching of anything referenced inside the files.

// Read every uploaded part into memory as UTF-8 text. Fine for note files, which
// are small; this would need streaming if it ever accepted archives.
async function readFiles(request: any): Promise<{ filename: string; buffer: string }[]> {
  const files: { filename: string; buffer: string }[] = [];
  for await (const part of request.files()) {
    const chunks: Buffer[] = [];
    for await (const chunk of part.file) chunks.push(chunk as Buffer);
    files.push({ filename: part.filename ?? "untitled.txt", buffer: Buffer.concat(chunks).toString("utf8") });
  }
  return files;
}

// Route each file to a parser by extension. An unrecognised extension is treated
// as plain text rather than rejected — a .note or .journal file is usually just
// text, and refusing it would be less useful than importing it as-is.
function parseFiles(files: { filename: string; buffer: string }[]): ParsedNote[] {
  const notes: ParsedNote[] = [];
  for (const f of files) {
    if (/\.csv$/i.test(f.filename)) {
      notes.push(...parseCsvFile(f.buffer));
    } else if (/\.json$/i.test(f.filename)) {
      try {
        notes.push(...parseJsonFile(f.filename, f.buffer));
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : "Invalid JSON file");
      }
    } else if (/\.html?$/i.test(f.filename)) {
      notes.push(parseHtmlFile(f.filename, f.buffer));
    } else {
      notes.push(parseTextFile(f.filename, f.buffer));
    }
  }
  return notes;
}

// Resolve a folder path/name to an id, creating folders along the path as needed
// (nested paths like "Work/Projects" become a folder chain). Cached per request.
async function resolveFolder(path: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(path)) return cache.get(path)!;
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  let parentId: string | null = null;
  let runningPath = "";
  for (const segment of segments) {
    runningPath = runningPath ? `${runningPath}/${segment}` : segment;
    if (cache.has(runningPath)) {
      parentId = cache.get(runningPath)!;
      continue;
    }
    let folder: Folder | null = await prisma.folder.findFirst({ where: { name: segment, parentFolderId: parentId } });
    if (!folder) {
      folder = await prisma.folder.create({ data: { name: segment, parentFolderId: parentId } });
    }
    cache.set(runningPath, folder.id);
    parentId = folder.id;
  }
  return parentId!;
}

async function getOrCreateTag(name: string, cache: Map<string, string>): Promise<string> {
  if (cache.has(name)) return cache.get(name)!;
  const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
  cache.set(name, tag.id);
  return tag.id;
}

export async function importRoutes(app: FastifyInstance) {
  // Preview only — parse the files and return notes-to-be-created. Never writes.
  app.post("/import/preview", async (request) => {
    const files = await readFiles(request);
    if (!files.length) throw badRequest("No files uploaded");
    const notes = parseFiles(files);
    return {
      count: notes.length,
      notes: notes.map((n) => ({
        title: n.title,
        preview: makePreview(n.content),
        tags: n.tags,
        folderPath: n.folderPath,
        createdAt: n.createdAt?.toISOString() ?? null,
      })),
    };
  });

  // Commit — create the notes. Honors folder/tag context inheritance passed as
  // query params when import is triggered from a folder/tag view (§3.8).
  app.post("/import/commit", async (request, reply) => {
    const { folderId: ctxFolderId, tagId: ctxTagId } = request.query as {
      folderId?: string;
      tagId?: string;
    };
    const files = await readFiles(request);
    if (!files.length) throw badRequest("No files uploaded");
    const parsed = parseFiles(files);

    const folderCache = new Map<string, string>();
    const tagCache = new Map<string, string>();
    const created = [];

    for (const note of parsed) {
      // Folder: explicit path in the file wins; otherwise inherit the view's folder.
      let folderId: string | null = ctxFolderId ?? null;
      if (note.folderPath) folderId = await resolveFolder(note.folderPath, folderCache);

      // Tags: file tags ∪ inherited tag from a tag view.
      const tagIds = new Set<string>();
      for (const t of note.tags) tagIds.add(await getOrCreateTag(t, tagCache));
      if (ctxTagId) tagIds.add(ctxTagId);

      const row = await prisma.note.create({
        data: {
          title: note.title,
          content: note.content as Prisma.InputJsonValue,
          // An import is the single largest source of French notes this app will
          // ever see — somebody arriving from another app with years of writing in
          // it. Classifying on the way in is what makes their library searchable
          // properly from the first minute rather than after they next edit each note.
          contentLanguage: detectNoteLanguage({ title: note.title, content: note.content }),
          folderId,
          // Preserve the note's original creation date when the import knows it
          // (e.g. a date parsed out of the title). Overrides the @default(now()).
          ...(note.createdAt ? { createdAt: note.createdAt } : {}),
          ...(tagIds.size ? { tags: { create: [...tagIds].map((tagId) => ({ tagId })) } } : {}),
        },
        include: noteInclude,
      });
      // A file can carry its pictures inside the document — a Lockpad JSON backup
      // does exactly that (see routes/export.ts). Turn them into real rows now that
      // the note exists to own them; without this they would sit in the document as
      // enormous base64 strings, re-sent in full on every subsequent save.
      const content = await absorbInlineImages(prisma, row.id, row.content);
      const finished =
        content === row.content
          ? row
          : await prisma.note.update({
              where: { id: row.id },
              data: {
                content: content as Prisma.InputJsonValue,
                // Absorbing inline pictures rewrote the document, so the language is
                // re-derived from what is actually being stored.
                contentLanguage: detectNoteLanguage({ title: row.title, content }),
              },
              include: noteInclude,
            });
      created.push(serializeNote(finished));
    }

    return reply.status(201).send({ count: created.length, notes: created });
  });
}
