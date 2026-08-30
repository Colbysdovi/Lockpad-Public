// The shape of the whole translation system, and the type machinery that makes a
// missing French string a build error rather than a bug somebody reports.
//
// ── Why this is hand-written and not i18next ────────────────────────────────
//
// The PRD's §3.3 says no UI surface may be left silently English-only. A runtime
// library answers a missing key by falling back to English and carrying on, which
// is exactly the failure it forbids: the app still works, nothing is logged, and
// the gap is found by a French reader rather than by the build. Deriving the French
// catalogue's TYPE from the English one moves that check to `tsc`, where a missing
// key stops the build and names itself. That, rather than bundle size, is the whole
// argument for writing this by hand.
//
// The second requirement (§4) is that the structure must not assume exactly two
// languages forever. Adding a third means adding one catalogue file and one entry to
// LOCALES. Nothing in this file counts to two.

/** Every language the interface is available in. Adding one is additive: append
 *  here, add a catalogue that satisfies `Catalog`, and register it in `catalogs`.
 *  No other file needs to change. */
export const LOCALES = ["en", "fr"] as const;

export type Locale = (typeof LOCALES)[number];

/** The language used when nothing better is known — an unrecognised browser
 *  preference (§3.1), or a note whose own language could not be determined (§7).
 *  One fallback, used everywhere, so the two cases can never diverge. */
export const FALLBACK_LOCALE: Locale = "en";

/** Human-readable names, each written IN ITS OWN LANGUAGE on purpose. The reader
 *  most likely to need "Français" is the one currently looking at an English
 *  interface they cannot read, so translating the language names would hide the
 *  option from exactly the person hunting for it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
};

/** Type guard — the only sanctioned way to turn an untrusted string (a stored
 *  preference, a browser header) into a Locale. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// ── Plurals ─────────────────────────────────────────────────────────────────
//
// English has two cardinal forms and French has three, and they do not line up:
// French treats 0 as singular ("0 note") where English treats it as plural
// ("0 notes"). A hand-written `n === 1 ? a : b` is therefore not a shortcut, it is
// the English rule hardcoded into every language — so counted strings go through
// Intl.PluralRules, which ships in the browser and knows the answer for both.
//
// `other` is required because every language has it; the rest are optional because
// which ones a language uses is the language's business, not this type's.

/** A counted message, one entry per plural category the language actually uses. */
export type PluralForms = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;

/** A catalogue entry: a plain string, or a set of plural forms. */
export type Message = string | PluralForms;

// ── Interpolation ───────────────────────────────────────────────────────────
//
// Placeholders are `{name}`. The types below read those names straight out of the
// English string's literal type, so `t("notes.selected", { ... })` knows which keys
// it needs and refuses the wrong ones. It costs a little type machinery and buys a
// whole class of bug — a renamed placeholder that silently renders as literal
// braces — being caught at compile time.

/** The placeholder names inside a message string, as a union of literals. */
export type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** What a value substituted into a message may be. Dates and objects are
 *  deliberately excluded: they format differently per locale, so they belong in the
 *  formatters in `format.ts` rather than being stringified into a sentence. */
export type Substitution = string | number;
