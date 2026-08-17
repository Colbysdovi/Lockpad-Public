import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const THEME_KEY = "lockpad.theme";

// Light/dark switching.
//
// Tailwind's dark variants key off a `dark` class on <html>, so the whole theme is
// one class toggle — every colour is a CSS custom property that gets redefined
// under it (see index.css). Nothing else needs to know the theme.
//
// The choice is remembered in localStorage and re-applied on load. Deliberately NOT
// derived from the OS preference: the default stays deterministic (light), which
// means what a new visitor sees is fixed and describable, and the app doesn't read
// a signal about the user's machine it has no need for.
function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) ?? "light");

  useEffect(() => {
    apply(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
