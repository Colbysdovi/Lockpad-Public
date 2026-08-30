import type { Locale } from "./types";

// Dates, times and numbers — the half of localization that is not translation.
//
// ── The bug this file exists to prevent ─────────────────────────────────────
//
// Before this, three separate places formatted a date with
// `toLocaleDateString(undefined, …)`. `undefined` means "use the BROWSER's locale",
// which is not the same thing as the language the user chose in Settings. A French
// interface on an English machine would have shown French buttons above English
// month names, and nothing would have looked broken enough to report. Every
// formatter here takes the app's locale explicitly and there is no default, so the
// mistake cannot be made by omission.
//
// The relative-time strings ("3h ago") were also hand-built with English suffixes
// concatenated onto a number. Intl.RelativeTimeFormat produces them per language —
// and gets the parts of the problem that are invisible from English, like French
// putting the marker in front ("il y a 3 h") rather than behind.

/** Intl objects are expensive to construct and these are asked for once per card,
 *  per render. Cached by locale and by the options that distinguish them. */
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<Locale, Intl.NumberFormat>();

function relativeFormatter(locale: Locale): Intl.RelativeTimeFormat {
  const cached = relativeFormatters.get(locale);
  if (cached) return cached;
  // `short`, and NOT `narrow`, on measured evidence rather than taste. `narrow` is
  // the compact style matching the note cards' existing "3h ago" density, and in
  // English it produces exactly that — but in French it renders a bare minus sign:
  //
  //   narrow   en: "8m ago"       fr: "-8 min"        <- unreadable
  //   short    en: "8 min. ago"   fr: "il y a 8 min"
  //
  // A negative number where a phrase belongs is not a slightly worse label, it is
  // garbage, so `narrow` is unusable here whatever it does for English. One style for
  // every language rather than a per-locale exception: the exception would be correct
  // today and would be the line nobody understands in a year, and what it buys is
  // four characters of English width.
  //
  // `numeric: "auto"` is what turns "1 day ago" into "yesterday", and into "hier".
  const made = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  relativeFormatters.set(locale, made);
  return made;
}

function dateFormatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${locale}:${JSON.stringify(options)}`;
  const cached = dateFormatters.get(cacheKey);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat(locale, options);
  dateFormatters.set(cacheKey, made);
  return made;
}

/** The thresholds at which a relative time changes unit, largest first.
 *
 *  Deliberately the same buckets the hand-written formatters used, so this change
 *  alters the LANGUAGE of the label and not how coarse it is. A note edited eight
 *  minutes ago said "8m ago" before and says "8 min. ago" now — same information,
 *  same granularity, phrased by the language rather than by a template. */
const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

/** "3h ago" / "il y a 3 h". Anything under a minute is "now" rather than "0 min.
 *  ago", which reads as broken. */
export function formatRelativeTime(locale: Locale, iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  const magnitude = Math.abs(elapsed);
  const formatter = relativeFormatter(locale);

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (magnitude >= ms) {
      // Negative because the value is in the past, which is what the sign means to
      // Intl: -3 hours is "3h ago", +3 hours is "in 3h".
      return formatter.format(-Math.round(elapsed / ms), unit);
    }
  }
  return formatter.format(0, "second");
}

/** A short calendar date — "12 Mar" / "12 mars". For anything old enough that a
 *  relative time has stopped being useful. */
export function formatShortDate(locale: Locale, iso: string): string {
  return dateFormatter(locale, { month: "short", day: "numeric" }).format(new Date(iso));
}

/** A full calendar date, with the year. */
export function formatLongDate(locale: Locale, iso: string): string {
  return dateFormatter(locale, { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));
}

/** A date and a time together, for the note detail's "last edited". */
export function formatDateTime(locale: Locale, iso: string): string {
  return dateFormatter(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** A number with the language's own grouping — 1,234 in English, 1 234 in French.
 *  Small counts are unaffected, which is most of them; this matters for the tag
 *  counts and export totals that can reach four figures. */
export function formatNumber(locale: Locale, value: number): string {
  let formatter = numberFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale);
    numberFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}
