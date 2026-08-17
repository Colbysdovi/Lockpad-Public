import { useEffect, useState } from "react";

// True below Tailwind's `sm` breakpoint (640px). Drives the note-sheet behavior
// (desktop pushes content aside; mobile slides up over it) and the sidebar
// drawer / bubble menu / composer-collapse switches. Deliberately matched to the
// CSS `sm:` breakpoint so JS structure and CSS sizing flip at the SAME width —
// otherwise the 640–768 band renders desktop structure at already-shrunk `sm:`
// sizing (and vice-versa), the involuntary mid-size inconsistency.
export function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return isMobile;
}
