import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { tOutsideReact } from "@/lib/i18n";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean; animClassName?: string; mobileSheet?: boolean }
>(({ className, children, hideClose, animClassName = "dialog-anim", mobileSheet, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="overlay-anim fixed inset-0 z-50 bg-[var(--backdrop)] backdrop-blur-sm" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Default enter/exit is a centred zoom (`dialog-anim`); a dialog can pass
        // `animClassName` for a different motion — e.g. the search palette slides
        // down from the top bar (`search-anim`).
        //
        // ── Why the centring below is an arbitrary `translate` property ──────────
        //
        // CSS applies the independent transform properties in a FIXED order —
        // translate, then rotate, then scale, then `transform` — with `transform`
        // innermost. Tailwind's `-translate-x-1/2` compiles to `transform`, so when
        // the open animation scaled the panel, the scale multiplied the centring
        // offset too: at `scale: 0.96` the panel was pulled back only 48% of its
        // width instead of 50%. Measured, the right edge held perfectly still and
        // the left edge travelled 20px — every modal grew out of its bottom-right
        // corner. (Written as an arbitrary property rather than Tailwind's own
        // translate-x/y utilities precisely because those compile to `transform`.)
        // Putting the centring in `translate` (the OUTERMOST property) means
        // nothing downstream can scale it, so the panel now zooms about its own
        // centre. Animations that need an offset use `transform` instead; see the
        // *-anim keyframes in index.css.
        animClassName,
        // Anchored a little above centre (42% vs 50%) so it lands closer to the
        // reading line / eye level rather than dead-centre. Individual dialogs can
        // still override `top-*` (e.g. the search palette) via twMerge.
        "fixed left-1/2 top-[42%] z-50 grid w-full max-w-lg [translate:-50%_-50%] gap-4 border bg-card p-6 shadow-lg rounded-lg",
        // Opt-in mobile treatment: on phones the dialog drops to a full-width bottom
        // sheet (thumb-reachable, native-feeling) instead of a centred desktop box.
        // Left before `className` so a caller can still override per-dialog.
        mobileSheet &&
          "max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-full max-sm:[translate:0_0] max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:pb-[calc(env(safe-area-inset-bottom)_+_1.25rem)]",
        className
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        // Padded icon button matching the app's other icon buttons (44px touch
        // target on mobile, 36px on desktop, shared hover-scrim) instead of a bare
        // low-contrast glyph.
        //
        // Tooltipped like every other icon-only button in the app. An X is close to
        // universal, but this one was the single icon button in the app with nothing
        // on hover, which reads as an unresponsive control rather than a self-evident
        // one. It opens BELOW the button (the default `top` would put it outside the
        // panel, floating on the overlay) and the sr-only label stays: the tooltip is
        // for the eye, that is what a screen reader reads.
        <Tooltip label={tOutsideReact("common.close")} side="bottom">
          <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover-scrim hover:text-foreground sm:h-9 sm:w-9">
            <X className="h-5 w-5 sm:h-4 sm:w-4" />
            <span className="sr-only">{tOutsideReact("common.close")}</span>
          </DialogPrimitive.Close>
        </Tooltip>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";
