import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../prisma.js";
import { detectNoteLanguage } from "./language.js";

// The one-time pass that classifies notes written before the app knew about
// languages, so search quality improves for a library that already exists rather than
// only for notes written from today.
//
// ── Why this is not in the migration ────────────────────────────────────────
//
// Detection is `franc`, which is JavaScript. SQL cannot call it. The migration gives
// every existing row the 'english' default — which is exactly what they were already
// being indexed with, so the migration is a no-op for them — and this reclassifies
// them once the app is running.
//
// ── Why it runs in the background ───────────────────────────────────────────
//
// It reads and rewrites every note. On a large library that is seconds, not
// milliseconds, and blocking startup on it would mean the app is unreachable for that
// whole time after an update — which is the one thing a Lockpad update must never do.
// So it starts after the server is listening and runs in batches. A library being
// reclassified is fully usable; its French notes are simply still searched with
// English rules, as they were yesterday.

/** Rows per batch. Small enough that the pass never holds a large result set in
 *  memory or a long transaction, large enough that a big library does not turn into
 *  thousands of round trips. */
const BATCH = 200;

/**
 * Classify every note that predates per-note language detection. Idempotent: the
 * completion timestamp on AppState means a restart mid-pass resumes rather than
 * repeating, and a finished pass never runs again.
 */
export async function classifyExistingNotes(log: FastifyBaseLogger): Promise<void> {
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  if (state?.notesClassifiedAt) return;

  const started = Date.now();
  let examined = 0;
  let changed = 0;
  let cursor: string | undefined;

  // Keyset pagination by id rather than skip/take: the pass writes to the same table
  // it is reading, and an offset-based walk over a table being modified can skip rows.
  // Ordering by a stable primary key cannot.
  for (;;) {
    const batch = await prisma.note.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, title: true, content: true, isLocked: true, contentLanguage: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const note of batch) {
      examined++;
      // Locked notes are skipped rather than classified. The server has only
      // ciphertext for them, and they index to an empty tsvector regardless — asking
      // the detector about one would be a bug, not merely wasted work.
      if (note.isLocked) continue;

      const detected = detectNoteLanguage(note);
      if (detected === note.contentLanguage) continue;

      // Writing contentLanguage regenerates content_tsv for this row, because the
      // generated column is derived from it. That is the whole reindex — there is no
      // second step, and no window where the language says French and the index still
      // holds English stems.
      await prisma.note.update({ where: { id: note.id }, data: { contentLanguage: detected } });
      changed++;
    }
  }

  await prisma.appState.upsert({
    where: { id: 1 },
    create: { id: 1, notesClassifiedAt: new Date() },
    update: { notesClassifiedAt: new Date() },
  });

  log.info(
    { examined, changed, ms: Date.now() - started },
    "Classified existing notes by language and reindexed the ones that changed"
  );
}
