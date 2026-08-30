// The public face of the i18n module. Import from `@/lib/i18n`, never from the
// files inside it — the split between catalogue, translator, formatters and
// provider is an implementation detail, and keeping it that way is what allows the
// mechanism to change later without touching two hundred call sites.

export { I18nProvider, useI18n, useT, useFormat, useLocale } from "./provider";
export { AppLanguageProvider } from "./AppLanguageProvider";
export { useLanguagePreference, detectBrowserLocale, SELECTABLE_LOCALES } from "./useLanguagePreference";
export { translate, tOutsideReact } from "./translate";
export { withSlot, withSlots, SLOT } from "./nodes";
export {
  formatRelativeTime,
  formatShortDate,
  formatLongDate,
  formatDateTime,
  formatNumber,
} from "./format";
export { LOCALES, LOCALE_NAMES, FALLBACK_LOCALE, isLocale } from "./types";
export type { Locale, Message, PluralForms } from "./types";
export type { MessageKey, Catalog } from "./catalog.en";
