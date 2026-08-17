import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { config } from "../config.js";
import { notFound } from "../errors.js";
import { STARTER_NOTES, STARTER_FOLDERS } from "../lib/starterNotes.js";

// Has this instance ever been welcomed?
//
// Two endpoints around a single boolean, which sounds like more ceremony than the
// question deserves until you notice what the answer controls: whether a brand-new
// user gets oriented, and — more importantly — whether three example notes get
// written into somebody's library. Getting it wrong in the "yes" direction is a
// small annoyance. Getting it wrong in the "no" direction puts content a person
// never asked for into the place they keep their own writing.
//
// The row is created by the migration, not by this code, precisely so the decision
// about existing libraries is made once against unambiguous evidence rather than
// re-derived on every boot. See the onboarding_state migration for that reasoning.
// These handlers therefore READ a row they can assume exists, and the one place that
// tolerates it being missing (`state()`) treats absence as "not onboarded" only
// because a database with no AppState row is, by construction, a database no
// migration has touched — i.e. genuinely new.

async function state() {
  const row = await prisma.appState.findUnique({ where: { id: 1 } });
  return {
    onboarded: !!row?.onboardedAt,
    onboardedAt: row?.onboardedAt ?? null,
    seeded: !!row?.seededAt,
  };
}

export async function onboardingRoutes(app: FastifyInstance) {
  // What the app shell asks on boot, before deciding whether to show anything.
  app.get("/onboarding", async () => state());

  // Completed or skipped — the same call, deliberately. The question this flag
  // answers is "has this person been offered the tour", and someone who dismissed it
  // has been offered it just as fully as someone who read every step. Giving skip its
  // own state would only create a third case nobody has a use for.
  //
  // Idempotent, and it keeps the FIRST timestamp: a double-submit from an impatient
  // click, or a replay from Settings finishing again, must not rewrite the moment
  // this instance stopped being new.
  app.post("/onboarding/complete", async () => {
    const existing = await prisma.appState.findUnique({ where: { id: 1 } });
    if (existing?.onboardedAt) return state();
    await prisma.appState.upsert({
      where: { id: 1 },
      create: { id: 1, onboardedAt: new Date() },
      update: { onboardedAt: new Date() },
    });
    return state();
  });

  // Write the three starter notes.
  //
  // This lives on the server, and that is a deliberate departure from the PRD's note
  // that seeding could reuse the client's `useCreateNote`. The reason is §3.1's own
  // acceptance criterion — "exactly once per instance". Seeding fires when the flow
  // STARTS, while the flag that ends it is only written when the user finishes or
  // skips, so a client-driven version has a real window: close the tab on step two,
  // come back, and the first-run condition is still true. You get six starter notes,
  // then nine. No amount of client-side care closes that window, because the client
  // is the thing that went away.
  //
  // Here the check and the writes are one transaction, so the guarantee holds no
  // matter how many tabs, reloads or impatient double-clicks arrive at once. The
  // constraint the PRD actually cared about — not reinventing note creation — still
  // holds: this composes the same Prisma calls the notes route already uses.
  app.post("/onboarding/seed", async () => {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.appState.findUnique({ where: { id: 1 } });
      if (row?.seededAt) return 0; // already done — say so quietly, don't error

      // Every starter folder up front, keyed by name, so a note can simply say which
      // one it belongs in. One folder was enough while only one note was filed; two
      // notes in two different folders is what makes the library demonstrate the idea
      // rather than assert it.
      const folderIds = new Map<string, string>();
      for (const spec of STARTER_FOLDERS) {
        const folder = await tx.folder.create({ data: spec });
        folderIds.set(spec.name, folder.id);
      }

      for (const spec of STARTER_NOTES) {
        const note = await tx.note.create({
          data: {
            title: spec.title,
            content: spec.content as object,
            folderId: spec.folder ? (folderIds.get(spec.folder) ?? null) : null,
          },
        });
        for (const name of spec.tags ?? []) {
          // Upsert rather than create: a tag of this name may already exist on an
          // instance that is empty of notes but not of everything.
          const tag = await tx.tag.upsert({
            where: { name },
            create: { name },
            update: {},
          });
          await tx.noteTag.create({ data: { noteId: note.id, tagId: tag.id } });
        }
      }

      await tx.appState.upsert({
        where: { id: 1 },
        create: { id: 1, seededAt: new Date() },
        update: { seededAt: new Date() },
      });
      return STARTER_NOTES.length;
    });
    return { ...(await state()), created };
  });

  // Development only: put the instance back to "never welcomed" so the first-run
  // path — animation, seeding, modal — can be replayed against the demo library
  // without rebuilding the database.
  //
  // Guarded on the SERVER, not merely hidden in the UI. A button the frontend
  // declines to render is not a control that does not exist; this route refuses in
  // production regardless of who calls it or what the client believes. For an app
  // whose entire proposition is that your notes are yours, a reset endpoint that
  // ships and merely trusts the caller is not a defensible thing to have written.
  //
  // It touches ONLY the flag. No note, folder or tag is created, altered or removed,
  // which is what makes it safe to fire repeatedly at the seeded dev library.
  app.post("/onboarding/reset", async () => {
    // 404 rather than 403, deliberately: in a production build this route should be
    // indistinguishable from one that was never written. A 403 confirms the endpoint
    // exists and merely refused, which is a small piece of free reconnaissance.
    if (config.isProduction) throw notFound();
    await prisma.appState.upsert({
      where: { id: 1 },
      // `seededAt` is deliberately LEFT ALONE, and that is the whole safety property
      // of this route. Clearing it would make the next load seed a second set of
      // starter notes on top of the first — three becomes six, then nine — because
      // the notes from last time are still sitting there. Proven the hard way: the
      // first run of this code did clear it, and the very next reload produced a
      // library with everything in it twice.
      //
      // So this re-arms the WIZARD, not the seeding. That matches what it is for:
      // iterating on the animation, the steps and the copy against the full demo
      // library, without adding or removing a single row. Exercising the seeding
      // path itself is a different job with a different tool — `SEED=none`, which
      // starts from a genuinely empty database where seeding is correct by
      // construction rather than by luck.
      create: { id: 1, onboardedAt: null },
      update: { onboardedAt: null },
    });
    return state();
  });
}
