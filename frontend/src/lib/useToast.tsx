import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, TriangleAlert, X } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { markReturning, type UndoKind } from "./noteFx";
import { EASE_FOLLOW, EASE_FOLLOW_REVERSED } from "@/lib/motion";
import { useT, tOutsideReact } from "@/lib/i18n";

// Notification tray (idea-brief-toast-notifications.md). Undoable actions (delete,
// archive — single + bulk) drop a toast into a bottom tray (centred on mobile,
// bottom-right on desktop, so it never lands on the composer). It is NOT a
// classic auto-vanishing toast: each entry stays for a long undo window (3 min),
// the countdown PAUSES while the user is hovering/focused inside the tray (WCAG
// 2.2.1 mitigation), and entries are dismissible individually or all at once.
// Session-only — no persistence. Styling uses the palette's dark-chip tokens
// (--tooltip / --tooltip-foreground) so it matches tooltips, with a warm shadow.

const UNDO_WINDOW = 180000; // 3 minutes

// How far below its resting place a toast starts (and ends). Enough to clear the bottom
// edge in the ordinary single-toast case: the chip is ~46px tall and the tray adds 1rem
// of padding under it, so 64px puts it out of sight. Kept a fixed distance rather than
// "100% of my own height" because a percentage is measured against the element's own
// box, which is the wrong reference the moment a toast wraps onto a second line. Users who ask for reduced motion never see any of this: the global
// <MotionConfig reducedMotion="user"> in main.tsx drops transform animations for them and
// leaves the opacity fade.
const TOAST_SLIDE_PX = 64;

// The glyph a toast wears when its call site did not pass one of its own. Undo toasts
// already pass their action's toolbar icon (delete/archive), and that stays: an explicit
// icon always wins, because "what you just did" is more useful there than "this went
// fine". Only messages with nothing better to show fall back to these.
const KIND_ICON: Record<ToastKind, ReactNode> = {
  default: null,
  success: <Check className="h-4 w-4" />,
  error: <TriangleAlert className="h-4 w-4" />,
};

// Screen readers get the severity in words, because the glyph is aria-hidden and a
// failure that announces exactly like a confirmation is a failure nobody hears. Kept as a
// short prefix rather than a rewritten sentence so the message still reads as written.
const kindPrefix = (kind: ToastKind): string =>
  kind === "error" ? tOutsideReact("toast.errorPrefix") : "";

interface ToastAction {
  label: string;
  onClick: () => void;
}
// How serious this message is. Deliberately NOT a colour scheme: the tray keeps its one
// dark-chip style, and severity arrives as a leading glyph plus the words themselves. Two
// reasons. This tray is a messages holder rather than a classic alert stack (see the note
// at the top), so re-theming it per severity would fight the pattern it was built as. And
// colour alone cannot carry meaning anyway — WCAG 1.4.1 — so the icon is not decoration
// on top of a colour, it IS the second channel.
export type ToastKind = "default" | "success" | "error";

interface ToastOptions {
  action?: ToastAction;
  duration?: number;
  kind?: ToastKind;
  // Optional leading glyph (delete/archive pass their toolbar icon); only the icon
  // and message differ between toast types — layout/behaviour stay identical.
  icon?: ReactNode;
  // Which cards this toast can put back, and which exit they played. Undo then
  // REWINDS that exit instead of just popping the note back into the list. It lives
  // on the toast rather than at each call site so undo stays a rewind for every
  // future undoable action too: pass the ids + kind and the animation is automatic.
  reverse?: { ids: string[]; kind: UndoKind };
}
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  icon?: ReactNode;
  reverse?: { ids: string[]; kind: UndoKind };
}

type ToastFn = (message: string, opts?: ToastOptions) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  // Named `tr`, not `t` — the tray below maps over toasts and binds `t` to one of
  // them. A shadowed translator compiles and then translates nothing.
  const tr = useT();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Mirror of the newest message in a dedicated live region — new toasts get
  // announced there rather than via the interactive tray (a live region can't
  // reliably expose interactive children to assistive tech; see the research note).
  const [announce, setAnnounce] = useState("");

  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const remaining = useRef<Map<number, number>>(new Map()); // ms left on the undo window
  const startedAt = useRef<Map<number, number>>(new Map()); // when the current run began
  const pausedRef = useRef(false);
  const toastsRef = useRef<ToastItem[]>([]);
  toastsRef.current = toasts;

  const forget = (id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    remaining.current.delete(id);
    startedAt.current.delete(id);
  };

  const dismiss = useCallback((id: number) => {
    forget(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    for (const id of [...timers.current.keys()]) forget(id);
    setToasts([]);
  }, []);

  // (Re)start a toast's countdown from whatever time it has left.
  const runTimer = useCallback((id: number) => {
    const rem = remaining.current.get(id);
    if (rem == null) return;
    startedAt.current.set(id, Date.now());
    timers.current.set(id, setTimeout(() => dismiss(id), rem));
  }, [dismiss]);

  const toast = useCallback<ToastFn>((message, opts) => {
    const id = ++idRef.current;
    const kind = opts?.kind ?? "default";
    remaining.current.set(id, opts?.duration ?? UNDO_WINDOW);
    setToasts((prev) => [...prev, { id, message, kind, action: opts?.action, icon: opts?.icon, reverse: opts?.reverse }]);
    // A trailing zero-width space on alternating toasts guarantees the live region's
    // text "changes" even when the same message fires twice in a row, so it re-announces.
    setAnnounce(kindPrefix(kind) + message + String.fromCharCode(0x200b).repeat(id % 2));
    if (!pausedRef.current) runTimer(id);
  }, [runTimer]);

  // Pause every countdown, banking each toast's remaining time.
  const pause = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    for (const [id, timer] of timers.current) {
      clearTimeout(timer);
      const started = startedAt.current.get(id) ?? Date.now();
      const rem = remaining.current.get(id) ?? 0;
      remaining.current.set(id, Math.max(0, rem - (Date.now() - started)));
    }
    timers.current.clear();
  }, []);

  // Resume every countdown from its banked remaining time.
  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    for (const t of toastsRef.current) runTimer(t.id);
  }, [runTimer]);

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Screen-reader announcement of the newest toast. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">{announce}</div>

      {/* The tray is mounted for the life of the app, empty or not, and this is
          load-bearing rather than tidy: AnimatePresence can only play a child's exit
          animation while AnimatePresence itself is still mounted. When this whole
          element was wrapped in `toasts.length > 0 &&`, dismissing the only toast set
          the count to 0, tore the tray down in the same render, and the exit never got
          a chance to run — the toast simply blinked out. Entrances were lost the same
          way: the tray remounted from nothing on every 0 -> 1 transition, so every
          toast was a first-render child, which is exactly what `initial={false}` used
          to skip. Empty, this is a zero-height, click-through div that costs nothing. */}
      {/* A labelled landmark region so AT users can jump straight here (not only via
          sequential tab order). Hover/focus inside pauses the auto-expiry. The role and
          label are dropped while the tray is empty so an idle app does not advertise an
          empty landmark. */}
      <section
        role={toasts.length > 0 ? "region" : undefined}
        aria-label={toasts.length > 0 ? `Notifications (${toasts.length})` : undefined}
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocus={pause}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(); }}
        // Ride the keyboard inset (--kb) so a toast's Undo stays reachable above
        // an open software keyboard on mobile (no-op on desktop / when closed).
        style={{ bottom: "var(--kb, 0px)" }}
        // Centred on mobile, right-aligned from sm: up. On a phone the composer fills
        // the width, so there is no "beside it" to sit in and a right-hugging tray just
        // looks lopsided. On desktop the composer is a centred max-w-2xl bar, so the
        // tray steps aside to the right rather than landing on top of it.
        className="pointer-events-none fixed inset-x-0 z-[100] mx-auto flex w-full max-w-[min(24rem,92vw)] flex-col items-stretch gap-2 p-4 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:inset-x-auto sm:right-0 sm:mx-0"
      >
        {toasts.length > 1 && (
          <button
            onClick={clearAll}
            className="pointer-events-auto self-end rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover-scrim hover:text-foreground"
          >
            {tr("toast.clearAll")}
          </button>
        )}
        {/* No `initial={false}` here: the tray is permanently mounted (see above), so
            there is no stale-children case to suppress, and suppressing it is what
            silently cancelled every entrance animation. */}
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              // Deliberately NO `layout` prop. It was here to slide the surviving toasts
              // up when one in the middle left, but framer's layout projection writes this
              // element's transform itself, and so competes for the same axis the
              // entrance/exit slide needs. What is lost is the reflow of a stack, which
              // needs two toasts on screen at once to even be visible; what is kept is a
              // slide that is guaranteed to play. If the reflow is wanted back it belongs
              // on a wrapper element, so the two transforms stop sharing one node.
              // A toast rises in from below the bottom edge and, when it is undone or
              // dismissed, drops back out the way it came. Vertical rather than the
              // sideways slide this used to have: the tray is now centred on mobile
              // (see the className below), so "in from the right" no longer matched
              // where the thing actually lives. Coming from off-screen also says where
              // notifications belong — down there, out of the way — which a 24px nudge
              // never did.
              initial={{ opacity: 0, y: TOAST_SLIDE_PX, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              // Exit rides the time-mirror of the entrance curve, per the motion
              // vocabulary in lib/motion.ts: the closing half of anything that opened
              // on FOLLOW closes on FOLLOW reversed. Slightly quicker than the
              // entrance, because leaving needs less watching than arriving.
              exit={{
                opacity: 0,
                y: TOAST_SLIDE_PX,
                scale: 0.96,
                transition: { duration: 0.2, ease: EASE_FOLLOW_REVERSED },
              }}
              transition={{ duration: 0.24, ease: EASE_FOLLOW }}
              role="group"
              aria-label={t.message}
              className="pointer-events-auto flex items-center gap-3 rounded-xl border border-[rgb(var(--shadow-color)/0.18)] bg-[var(--tooltip)] px-4 py-3 text-sm text-[var(--tooltip-foreground)] shadow-[0_10px_30px_-10px_rgb(var(--shadow-color)/0.5)]"
            >
              {/* aria-hidden: the words already say what happened, so the glyph must
                  not be read out a second time. */}
              {(t.icon ?? KIND_ICON[t.kind]) && (
                <span aria-hidden className="shrink-0 opacity-90">{t.icon ?? KIND_ICON[t.kind]}</span>
              )}
              <span className="min-w-0 flex-1">{t.message}</span>
              {t.action && (
                <button
                  onClick={() => {
                    // Claim the rewind BEFORE firing the undo: the restored cards can
                    // mount as soon as its refetch lands, and a card that mounts with
                    // nothing claimed just appears, with no animation to play.
                    if (t.reverse) markReturning(t.reverse.ids, t.reverse.kind);
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                  className="shrink-0 rounded-md bg-[var(--tooltip-foreground)] px-2.5 py-1 text-xs font-semibold text-[var(--tooltip)] transition-opacity hover:opacity-90"
                >
                  {t.action.label}
                </button>
              )}
              <Tooltip label={tr("toast.dismiss")} side="top">
                <button
                  onClick={() => dismiss(t.id)}
                  aria-label={tr("toast.dismissNotification")}
                  className="shrink-0 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </Tooltip>
            </motion.div>
          ))}
        </AnimatePresence>
      </section>
    </ToastContext.Provider>
  );
}
