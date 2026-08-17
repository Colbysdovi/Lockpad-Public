import { useEffect } from "react";

// Publish the on-screen keyboard's height as the CSS var --kb on <html>, so that
// bottom-anchored UI (the composer, the bulk bar, the mobile note sheet, the toast
// tray) can lift above the software keyboard on mobile instead of hiding behind it.
//
// iOS Safari does NOT shrink the layout viewport (or 100dvh) when the keyboard
// opens — only window.visualViewport tracks the actually-visible area. We derive
// the covered height from it and expose it as --kb; consumers add it to their
// bottom offset. A no-op where visualViewport is absent (older engines / desktop),
// where --kb simply stays unset and `var(--kb, 0px)` resolves to 0.
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      // Height of the region the keyboard (and any bottom browser chrome the
      // visual viewport reports) covers at the bottom of the layout viewport.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Ignore sub-threshold noise (address-bar jitter, rounding) so we only lift
      // for a real keyboard, never for a few stray pixels.
      root.style.setProperty("--kb", `${covered > 80 ? Math.round(covered) : 0}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--kb");
    };
  }, []);
}
