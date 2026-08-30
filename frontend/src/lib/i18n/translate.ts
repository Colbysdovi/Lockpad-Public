import { en, type Catalog, type MessageKey } from "./catalog.en";
import { fr } from "./catalog.fr";
import { FALLBACK_LOCALE, type Locale, type Message, type Placeholders, type Substitution } from "./types";

// Looking a message up. Deliberately a plain function with the locale as its first
// argument rather than a hook, so the same code path serves React components, event
// handlers, and anything else that needs a string without being inside a render.
// `useT()` in `provider.tsx` is a thin binding over this, not a second implementation.

/** Every catalogue, by locale. A third language is one entry here and one file. */
const catalogs: Record<Locale, Catalog> = { en, fr };

/** The placeholder names a given key needs supplied.
 *
 *  For a counted message the names come from the `other` form, which is the one
 *  form every language is required to have, plus `count` itself. A language whose
 *  `one` form used a placeholder its `other` form did not would be outside what
 *  this can check — worth knowing, not worth designing for, since a counted message
 *  that changes its own placeholders between forms is a translation mistake. */
type ParamsFor<K extends MessageKey> = (typeof en)[K] extends string
  ? Placeholders<(typeof en)[K]>
  : (typeof en)[K] extends { other: infer Other extends string }
    ? "count" | Placeholders<Other>
    : never;

/** The argument list for a key: nothing at all when the message has no
 *  placeholders, and a fully-typed object when it does. This is what makes
 *  `t("common.cancel")` legal and `t("notes.count")` a compile error. */
export type TranslateArgs<K extends MessageKey> = [ParamsFor<K>] extends [never]
  ? []
  : [params: Record<ParamsFor<K>, Substitution>];

/** Substitute `{name}` placeholders. Unknown names are left standing rather than
 *  replaced with "undefined": a visible `{name}` in the interface is a bug that
 *  reports itself, where the word "undefined" reads as a crash to the user and as
 *  nothing at all to whoever is scanning the screen for problems. */
function interpolate(template: string, params: Record<string, Substitution> | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole
  );
}

/** Cached plural selectors. Constructing an Intl object is not free and a note list
 *  asks for counted strings on every render, so the instances are kept per locale
 *  rather than rebuilt per call. */
const pluralRules = new Map<Locale, Intl.PluralRules>();

function pluralRuleFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

/** Pick the right form for a count, in this language's own terms.
 *
 *  The fallback chain matters: the selected category first, then `other`, which
 *  every language has. So a French catalogue that supplies only `one` and `other`
 *  still answers correctly when CLDR selects `many` for a large number — it lands on
 *  `other` rather than on nothing. */
function selectPlural(locale: Locale, forms: Exclude<Message, string>, count: number): string {
  const category = pluralRuleFor(locale).select(count);
  return forms[category] ?? forms.other;
}

/**
 * Resolve one message in one language.
 *
 * The English catalogue is consulted when a locale is somehow missing an entry.
 * The types make that unreachable through normal use — a catalogue that misses a key
 * does not compile — but a runtime guard costs one comparison and turns a would-be
 * blank button into a legible English one, which is the better of the two failures.
 */
export function translate<K extends MessageKey>(
  locale: Locale,
  key: K,
  ...args: TranslateArgs<K>
): string {
  const params = args[0] as Record<string, Substitution> | undefined;
  const entry: Message = catalogs[locale][key] ?? catalogs[FALLBACK_LOCALE][key];

  if (typeof entry === "string") return interpolate(entry, params);

  // A counted message. `count` is required by the types above, so its absence here
  // means someone reached this through an untyped path; treating that as zero keeps
  // the sentence grammatical instead of rendering "NaN".
  const count = Number(params?.count ?? 0);
  return interpolate(selectPlural(locale, entry, count), params);
}

// ── Translating from outside React ──────────────────────────────────────────
//
// Some of this app is not components. The block drag handle builds its menu and its
// screen-reader announcements with plain DOM calls inside a ProseMirror plugin, and a
// TipTap node's renderHTML is a pure function — neither can call a hook. They still
// produce user-facing text, and §3.3 does not exempt a surface for being awkward to
// reach.
//
// So the active locale is mirrored here, written by the provider whenever it changes.
// This is a deliberate escape hatch and not a second source of truth: nothing reads
// `activeLocale` to DECIDE the language, only to render in whatever the provider has
// already decided. Inside a component, always use `useT` — a module-level read does
// not re-render when the language changes, which is exactly the bug it looks like it
// is not.
let activeLocale: Locale = FALLBACK_LOCALE;

/** Called by I18nProvider. Not for anything else. */
export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
}

/** Translate outside a component. See the note above before reaching for it. */
export function tOutsideReact<K extends MessageKey>(key: K, ...args: TranslateArgs<K>): string {
  return translate(activeLocale, key, ...args);
}
