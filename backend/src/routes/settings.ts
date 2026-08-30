import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { languagePreferenceInput } from "../schemas.js";

// Account-level interface settings. One value so far: the language.
//
// ── Why the server holds this at all ────────────────────────────────────────
//
// The theme is stored in the browser, and language deliberately is not. A theme is a
// preference about a screen, so a different screen reasonably gets a different
// answer. A language is a fact about the person, and the same person on their phone
// and their laptop is still reading the same language — asking them twice is asking
// them to correct the app. The idea brief records this divergence on purpose, so that
// nobody later "fixes" the inconsistency by moving one to match the other.
//
// The value lives on `AppState`, the single row that already holds the other
// account-wide facts. Lockpad is single-user by design, so that row IS the account;
// there is no user table to hang this off and adding one would be a product decision
// rather than a refactor.

/** NULL means never chosen — see the migration for why that distinction carries the
 *  whole of §3.1 and §3.2. Anything else is the user's authoritative answer. */
async function readLanguage(): Promise<{ language: string | null }> {
  const row = await prisma.appState.findUnique({ where: { id: 1 } });
  return { language: row?.uiLanguage ?? null };
}

export async function settingsRoutes(app: FastifyInstance) {
  // What the app shell asks on boot, before it decides whether to consult the
  // browser. A missing row answers `null` for the same reason `onboarding.ts` treats
  // absence as "not onboarded": a database with no AppState row is one no migration
  // has touched, which is to say genuinely new.
  app.get("/settings/language", async () => readLanguage());

  // Set the interface language.
  //
  // The value is validated against the supported set rather than stored as given.
  // This is not defensive habit: the column is a plain TEXT column, and an unchecked
  // write would let a typo or a stale client persist a locale that has no catalogue —
  // at which point every future boot reads back a language the app cannot render and
  // the user has no way to correct it from an interface they can no longer read.
  // Rejecting at the door keeps the stored value always renderable.
  app.put("/settings/language", async (request) => {
    const { language } = languagePreferenceInput.parse(request.body);
    await prisma.appState.upsert({
      where: { id: 1 },
      // Only this column is named in either branch, so onboardedAt and seededAt are
      // untouched by a language change — a settings write must never be able to make
      // an existing library look new.
      create: { id: 1, uiLanguage: language },
      update: { uiLanguage: language },
    });
    return readLanguage();
  });
}
