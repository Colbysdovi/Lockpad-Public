import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsMobile } from "@/lib/useIsMobile";
import { SheetGrabber } from "@/components/ui/sheet-grabber";

// A picker shell that is a Radix Popover anchored to its trigger on DESKTOP, and a
// bottom sheet (drawer + blurred backdrop, with a grab handle) on MOBILE — the
// native-feeling, thumb-reachable pattern for touch, and one that can't get clipped
// at the viewport edge the way a small anchored popover can. Same controlled `open`
// state and the same panel `children` feed both; only the shell differs.
//
// `trigger` must be a single focusable element (rendered via `asChild`). `title`
// labels the sheet (shown on mobile, and always announced for a11y).
//
// `triggerLabel` adds a hover/focus tooltip to the trigger. It lives HERE rather than
// at the call site because a tooltip and a popover sharing one trigger only compose in
// one order — the tooltip trigger has to be the OUTER of the two `asChild` slots — and
// callers hand us the bare element, so they can't express that nesting themselves.
// Desktop only: touch has no hover, and the sheet already carries a visible `title`.
export function ResponsivePopover({
  open,
  onOpenChange,
  trigger,
  title,
  children,
  contentClassName,
  align = "start",
  triggerLabel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  trigger: React.ReactNode;
  title: string;
  triggerLabel?: string;
  children: React.ReactNode;
  contentClassName?: string;
  align?: "start" | "center" | "end";
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        {/* min-height keeps a sparse drawer (a handful of items) from opening as an
            awkward sliver; content stays top-aligned and the sheet grows past this
            when it has more to show. Slides up from the bottom edge (sheet-anim).
            onOpenAutoFocus is prevented so opening a picker drawer does NOT auto-focus
            its search field and pop the iOS keyboard — most drawers are pick-from-a-list,
            not type-first; the user taps the field only when they actually want to type. */}
        <DialogContent
          mobileSheet
          hideClose
          animClassName="sheet-anim"
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="flex flex-col gap-0 p-0 max-sm:min-h-[42vh]"
        >
          {/* Grab handle — and a real one: drag it down to dismiss. */}
          <SheetGrabber onClose={() => onOpenChange(false)} />
          <DialogTitle className="px-4 pb-1 pt-1 text-base">{title}</DialogTitle>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip label={triggerLabel}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      </Tooltip>
      <PopoverContent align={align} className={contentClassName}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
