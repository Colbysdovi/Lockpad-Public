import { franc } from "franc";
import { extractPlainText } from "./tiptap.js";

// Which language a note is written in, so it can be indexed and searched with that
// language's rules rather than with English's regardless.
//
// ── What the values are ─────────────────────────────────────────────────────
//
// The stored value is a PostgreSQL text-search configuration name ("english",
// "french"), not an interface locale ("en", "fr"). They are different things that
// happen to correspond today: one names a stemmer and a stop-word list, the other
// names a catalogue of translated strings. Storing the config name means the
// generated tsvector column can branch on this column directly, with no mapping
// table in SQL that could fall out of step with a mapping table in TypeScript.
//
// ── Why detection is not the note's own business ────────────────────────────
//
// The user is never asked. A per-note language picker would be one more control on
// every note for a decision the text already answers, and it would be wrong the
// moment somebody edits a note from one language into the other and forgets.

/** The PostgreSQL text-search configurations this app indexes with. */
export const SEARCH_CONFIGS = ["english", "french"] as const;
export type SearchConfig = (typeof SEARCH_CONFIGS)[number];

/** Used when the language cannot be determined confidently — PRD §7 asks for one
 *  predictable fallback rather than "unindexed" or "whatever franc guessed", and it
 *  is deliberately the same fallback the interface uses when the browser's language
 *  is unrecognised. */
export const FALLBACK_CONFIG: SearchConfig = "english";

/** franc answers ISO 639-3. */
const CONFIG_BY_ISO: Record<string, SearchConfig> = { eng: "english", fra: "french" };

/**
 * The shortest text worth classifying.
 *
 * Measured, not guessed — see `docs/forge/app-localization-detection-spike.md`. Above
 * fifteen characters franc was correct on every sample in the spike corpus. Below it,
 * it guesses: "Réunion mardi" is thirteen characters, unambiguously French, and comes
 * back English. Two words is not enough signal for a trigram model.
 *
 * The guard lives here rather than in franc's own `minLength` because the two do
 * different jobs. franc's knob suppresses an answer; this records why there was none,
 * and keeps the reason next to the evidence for it.
 *
 * What it costs is small and worth stating: a note of fifteen characters or fewer is
 * two or three words, where stemming and stop-word removal have almost nothing to do.
 * "Acheter du pain" indexed with English rules is still found by searching "pain".
 * What it prevents is the failure that actually degrades search — a French note
 * confidently indexed as English.
 */
export const MIN_DETECTABLE_CHARS = 16;

/**
 * Work out which text-search configuration a note should be indexed with.
 *
 * Locked notes are never passed to detection by any caller, and the guard here is a
 * second line rather than the first: the server holds only ciphertext for them, so
 * there is nothing to classify, and asking would be a bug rather than merely waste.
 */
export function detectNoteLanguage({
  title,
  content,
  isLocked,
}: {
  title?: string | null;
  content?: unknown;
  isLocked?: boolean;
}): SearchConfig {
  if (isLocked) return FALLBACK_CONFIG;

  // The same text the search index is built from, so the language a note is
  // classified as is decided by exactly the words that will be indexed. Deriving
  // them differently is how the two could ever disagree about the same note.
  const text = [title ?? "", content ? extractPlainText(content) : ""].join(" ").trim();

  if (text.length < MIN_DETECTABLE_CHARS) return FALLBACK_CONFIG;

  // `only` constrains franc to the two languages this app can actually index. Left
  // open it would happily answer Catalan or Occitan for French text, and every such
  // answer would land in the fallback branch below — a correct classification thrown
  // away for want of a constraint.
  const iso = franc(text, { only: Object.keys(CONFIG_BY_ISO) });
  return CONFIG_BY_ISO[iso] ?? FALLBACK_CONFIG;
}

/** Narrow an untrusted string to a configuration name. Used where a value arrives
 *  from the database rather than from detection — an older row, a restored backup. */
export function isSearchConfig(value: unknown): value is SearchConfig {
  return typeof value === "string" && (SEARCH_CONFIGS as readonly string[]).includes(value);
}
