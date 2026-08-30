import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { FALLBACK_LOCALE, LOCALES, isLocale, type Locale } from "./types";

// Where the interface language comes from, and — more importantly — where it stops
// coming from.
//
// ── The rule ────────────────────────────────────────────────────────────────
//
// The browser is consulted EXACTLY ONCE, on an account that has never had a
// language. After that the stored value is authoritative forever. This is the
// difference between a helpful default and an app that argues with you: someone who
// deliberately chooses English on a French machine must not be switched back on
// their next visit by a signal they did not set.
//
// The server answers `null` for "never chosen", which is the whole reason that
// column has no default. See the ui_language migration.

const KEY = ["settings", "language"] as const;

/** The browser's own answer, mapped onto a language we actually have.
 *
 *  `navigator.languages` is an ordered preference list ("fr-CA", "fr", "en-US"), so
 *  it is walked in order and the first supported one wins — a Québécois browser
 *  should land on French, not fall through to English because "fr-CA" is not a
 *  literal match. Region is dropped because Lockpad translates languages, not
 *  regions; if that ever stops being true, this is the function that changes. */
export function detectBrowserLocale(
  languages: readonly string[] = navigator.languages ?? [navigator.language]
): Locale {
  for (const tag of languages) {
    const base = tag.split("-")[0]?.toLowerCase();
    if (isLocale(base)) return base;
  }
  // §3.1: an unrecognised browser language falls back to one fixed, predictable
  // default rather than to whatever happens to be first in LOCALES.
  return FALLBACK_LOCALE;
}

// A browser-local COPY of the account's language. Not the source of truth — the
// account is, and the idea brief is explicit that language follows the person across
// devices rather than living per-browser.
//
// It exists to solve one specific problem: the stored preference arrives over the
// network, and rendering English while waiting for it means a French user watches
// the interface flip languages on every single load. Caching the last known answer
// lets the first paint already be right. When the server disagrees, the server wins
// and the cache is corrected.
const CACHE_KEY = "lockpad.language";

function readCache(): Locale | null {
  const cached = localStorage.getItem(CACHE_KEY);
  return isLocale(cached) ? cached : null;
}

/**
 * The active interface language, and the only sanctioned way to change it.
 *
 * Returns immediately with the best answer available — the cached one, or the
 * browser's — and corrects itself once the account's stored value arrives.
 */
export function useLanguagePreference({
  enabled,
}: {
  /** Whether there is a session to ask. The endpoint is behind the auth guard, so
   *  asking while locked would 401 — and a 401 drops the app back to the login
   *  screen, which would make the unlock screen unreachable in a loop. While locked
   *  the interface falls back to the cache, then to the browser, which is the right
   *  answer anyway: a visitor at the unlock screen should see it in their own
   *  language before they have proved they can read anything else. */
  enabled: boolean;
}): { locale: Locale; setLocale: (locale: Locale) => void } {
  const queryClient = useQueryClient();

  const stored = useQuery({
    queryKey: KEY,
    enabled,
    queryFn: () => api.get<{ language: string | null }>("/settings/language"),
    // The account's language does not change behind the app's back — this instance
    // is the only thing that writes it — so there is no reason to re-ask on focus or
    // to treat the answer as going stale.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const write = useMutation({
    mutationFn: (language: Locale) =>
      api.put<{ language: string | null }>("/settings/language", { language }),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
  });

  // What to show right now. Precedence is: what the account says, then what this
  // browser last saw, then what this browser prefers.
  const serverLocale = isLocale(stored.data?.language) ? stored.data.language : null;
  const locale = serverLocale ?? readCache() ?? detectBrowserLocale();

  // Auto-detection, once. The ref is what makes "once" true across re-renders: the
  // query settles, this effect runs, and without the guard a slow write would let a
  // second render fire a second POST at the same endpoint.
  const detectionAttempted = useRef(false);
  useEffect(() => {
    if (detectionAttempted.current) return;
    // Only when the server has actually answered, and answered "never chosen".
    // Firing while the query is still loading would write a browser-derived language
    // over an existing preference, which is precisely what §3.2 forbids.
    if (!enabled || !stored.isSuccess || stored.data.language !== null) return;
    detectionAttempted.current = true;
    write.mutate(detectBrowserLocale());
  }, [enabled, stored.isSuccess, stored.data, write]);

  // Keep the first-paint cache in step with whatever is actually being shown.
  useEffect(() => {
    localStorage.setItem(CACHE_KEY, locale);
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      // Written to the account, never only to the cache. A language that lived in
      // localStorage would be a different setting on every device, which is the
      // thing this feature exists not to be.
      write.mutate(next);
    },
    [write]
  );

  return { locale, setLocale };
}

/** Every language the user may choose between, for the Settings control. Exported
 *  from here rather than read from `LOCALES` directly at the call site so the
 *  control and the detection can never end up disagreeing about what is supported. */
export const SELECTABLE_LOCALES = LOCALES;
