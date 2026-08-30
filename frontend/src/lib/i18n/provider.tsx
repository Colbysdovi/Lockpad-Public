import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { translate, setActiveLocale, type TranslateArgs } from "./translate";
import type { MessageKey } from "./catalog.en";
import { FALLBACK_LOCALE, type Locale } from "./types";
import { formatDateTime, formatLongDate, formatNumber, formatRelativeTime, formatShortDate } from "./format";

// The active language, made available to the tree.
//
// The provider is CONTROLLED — it is handed a locale and a setter rather than owning
// them. That split is deliberate: where the language comes from (a stored account
// preference, falling back to the browser exactly once) is a question about
// persistence and first-run behaviour, and it belongs to `useLanguagePreference`
// rather than to the thing that hands strings to components. Keeping it out of here
// also means this provider can be mounted around a single component in isolation
// with a plain `useState`, which is what makes it testable at all.

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Look up a message. Typed: unknown keys and missing placeholders are compile
   *  errors, not blank spaces at runtime. */
  t: <K extends MessageKey>(key: K, ...args: TranslateArgs<K>) => string;
  /** Locale-bound date, time and number formatting. Bound so no caller has to
   *  remember to pass the locale — passing the wrong one, or none, is exactly the
   *  bug `format.ts` was written to prevent. */
  format: {
    relativeTime: (iso: string) => string;
    shortDate: (iso: string) => string;
    longDate: (iso: string) => string;
    dateTime: (iso: string) => string;
    number: (value: number) => string;
  };
}

// The default value is a working English translator rather than `null` or a thrown
// error. A component rendered outside the provider — a test, a Storybook-style
// harness, an error boundary that lost its ancestors — shows readable English
// instead of crashing, and `setLocale` is a no-op because there is nothing to set.
const I18nContext = createContext<I18nValue>({
  locale: FALLBACK_LOCALE,
  setLocale: () => {},
  t: (key, ...args) => translate(FALLBACK_LOCALE, key, ...args),
  format: {
    relativeTime: (iso) => formatRelativeTime(FALLBACK_LOCALE, iso),
    shortDate: (iso) => formatShortDate(FALLBACK_LOCALE, iso),
    longDate: (iso) => formatLongDate(FALLBACK_LOCALE, iso),
    dateTime: (iso) => formatDateTime(FALLBACK_LOCALE, iso),
    number: (value) => formatNumber(FALLBACK_LOCALE, value),
  },
});

export function I18nProvider({
  locale,
  setLocale,
  children,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  children: ReactNode;
}) {
  // WCAG 3.1.1: the document's declared language has to match the language actually
  // on screen, or a screen reader pronounces French with English phonetics — which
  // is not a cosmetic problem, it is the text becoming unintelligible when read
  // aloud. It lives here because this is the one place that always knows the answer.
  useEffect(() => {
    document.documentElement.lang = locale;
    // Mirror the locale where non-React code can read it — the block drag handle's
    // DOM menu, a TipTap node's renderHTML. See the note in translate.ts.
    setActiveLocale(locale);
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, ...args) => translate(locale, key, ...args),
      format: {
        relativeTime: (iso) => formatRelativeTime(locale, iso),
        shortDate: (iso) => formatShortDate(locale, iso),
        longDate: (iso) => formatLongDate(locale, iso),
        dateTime: (iso) => formatDateTime(locale, iso),
        number: (value) => formatNumber(locale, value),
      },
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Everything at once — the locale, the setter, `t`, and the formatters. */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/** Just the translator, which is what most components want.
 *
 *  `const t = useT()` then `t("nav.allNotes")`. Kept separate from `useI18n` so a
 *  component that only renders text does not re-render when something it never
 *  reads happens to change. */
export function useT(): I18nValue["t"] {
  return useContext(I18nContext).t;
}

/** Just the formatters, for cards and lists that render dates but no copy. */
export function useFormat(): I18nValue["format"] {
  return useContext(I18nContext).format;
}

/** Just the active locale, for the few places that need to branch on it. */
export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}
