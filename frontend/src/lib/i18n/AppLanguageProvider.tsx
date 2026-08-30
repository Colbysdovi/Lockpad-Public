import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { LanguageSwitchVeil } from "@/components/LanguageSwitchVeil";
import { LANGUAGE_SWAP_DELAY_MS, LANGUAGE_SWITCH_MS } from "@/lib/motion";
import { I18nProvider } from "./provider";
import { useLanguagePreference } from "./useLanguagePreference";
import type { Locale } from "./types";

/** The class that tells the stylesheet to blur the app. Applied to <html> for the
 *  same reason the dark theme is: one toggle at the root, and every rule that cares
 *  keys off it without any component needing to know. */
const SWITCHING_CLASS = "lang-switching";

/**
 * Joins the two halves: where the language comes from, and who gets told about it.
 *
 * It exists as its own component rather than as code in `main.tsx` because
 * `useLanguagePreference` is a hook and `main.tsx` renders no component of its own —
 * and because the ordering constraints below are worth stating somewhere they can be
 * read next to what they constrain.
 *
 * It must sit BELOW `QueryClientProvider` (it queries) and `AuthProvider` (it asks
 * whether there is a session), and ABOVE everything that renders copy — which
 * includes `ToastProvider`, since the toast tray renders its own strings.
 */
export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const reduceMotion = useReducedMotion();
  // The preference lives behind the auth guard, so it is only fetched once the API
  // will actually answer. Before that the unlock screen still gets a language — the
  // cache, or the browser's own preference — because a visitor should be able to
  // read the screen that asks them for a password.
  //
  // BOTH "authed" and "open" count, and the distinction is not academic: "open" is
  // what an instance with no APP_PASSWORD reports, which is a supported way to run
  // Lockpad. Gating on "authed" alone looked right, passed a typecheck, and meant
  // that on a passwordless instance the query never ran, the preference was never
  // written, and first-run detection silently did nothing forever — while the
  // interface still showed the correct language, because the browser fallback was
  // quietly doing the job the account was supposed to do. Caught by checking the
  // stored value after a load, not by looking at the screen.
  const usable = status === "authed" || status === "open";
  const { locale, setLocale } = useLanguagePreference({ enabled: usable });

  // ── Two locales, on purpose ───────────────────────────────────────────────
  //
  // `locale` is what the ACCOUNT says. It is written the moment the button is
  // clicked, because the click is the decision and losing it to a closed tab would be
  // worse than any animation.
  //
  // `displayLocale` is what the SCREEN currently says. During a switch it deliberately
  // lags behind, so the change lands while the veil is covering the app instead of in
  // front of the reader. Everything downstream — every `t()` call, the Settings tick,
  // `<html lang>` — reads this one, so they all move together, at the moment the veil
  // is thickest.
  const [displayLocale, setDisplayLocale] = useState(locale);
  const [switching, setSwitching] = useState(false);

  // Outside a switch, the screen simply shows what the account says. This is what
  // handles every language change that is NOT somebody pressing the button: the first
  // load, where the stored preference arrives from the API a moment after the cached
  // guess, and first-run detection writing a language for a brand-new account. Those
  // are corrections, not events, and they should not be dressed up as one.
  useEffect(() => {
    if (!switching) setDisplayLocale(locale);
  }, [locale, switching]);

  // ── The switch, given a beat ──────────────────────────────────────────────
  //
  // Three things happen on three different clocks: the veil arrives, the language
  // changes underneath it, and the veil leaves. The middle one used to happen at the
  // click, which meant the interface visibly re-translated while the veil was still
  // fading in — the reader watched the change and then got a spinner for it. See
  // LANGUAGE_SWAP_DELAY_MS.
  const swapTimer = useRef<number | null>(null);
  const endTimer = useRef<number | null>(null);

  const switchLocale = useCallback(
    (next: Locale) => {
      if (next === locale) return; // choosing the current language is not an event

      // The account is told immediately, whatever the animation does afterwards.
      setLocale(next);

      // Someone who has asked their machine for less movement is not asking for a
      // theatrical pause; holding the interface back from them for a second with no
      // veil to explain it would just be an unresponsive button.
      if (reduceMotion) {
        setDisplayLocale(next);
        return;
      }

      setSwitching(true);
      if (swapTimer.current !== null) window.clearTimeout(swapTimer.current);
      if (endTimer.current !== null) window.clearTimeout(endTimer.current);
      swapTimer.current = window.setTimeout(() => {
        setDisplayLocale(next);
        swapTimer.current = null;
      }, LANGUAGE_SWAP_DELAY_MS);
      endTimer.current = window.setTimeout(() => {
        setSwitching(false);
        endTimer.current = null;
      }, LANGUAGE_SWITCH_MS);
    },
    [locale, setLocale, reduceMotion]
  );

  // The blur is a class on <html> rather than a wrapper element, because wrapping the
  // app in a div to filter it would introduce a new containing block — `filter`
  // creates one — and the app is full of `fixed` chrome that would suddenly position
  // against the wrapper instead of the viewport. A class changes nothing structural.
  useEffect(() => {
    document.documentElement.classList.toggle(SWITCHING_CLASS, switching);
  }, [switching]);

  // A pending timer outliving the component would call setState on an unmounted tree
  // and, worse, leave <html> blurred with nothing left to clear it. Nothing is lost by
  // dropping a pending swap here: the account was written at the click.
  useEffect(
    () => () => {
      if (swapTimer.current !== null) window.clearTimeout(swapTimer.current);
      if (endTimer.current !== null) window.clearTimeout(endTimer.current);
      document.documentElement.classList.remove(SWITCHING_CLASS);
    },
    []
  );

  return (
    <I18nProvider locale={displayLocale} setLocale={switchLocale}>
      {children}
      {/* A SIBLING of the app, not a child: the blur is applied to `.app-shell`, and
          a veil inside it would be blurred too — a blurred spinner reads as a
          rendering fault rather than as a wait. */}
      <LanguageSwitchVeil active={switching} />
    </I18nProvider>
  );
}
