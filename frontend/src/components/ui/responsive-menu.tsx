import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { useIsMobile } from "@/lib/useIsMobile";
import { cn } from "@/lib/utils";
import { SheetGrabber } from "@/components/ui/sheet-grabber";

// An action menu that is a Radix DropdownMenu anchored to its trigger on DESKTOP,
// and a bottom-sheet drawer (grab handle + big tappable rows) on MOBILE — the
// action-sheet counterpart to ResponsivePopover, for the app's "⋮ More" menus.
// The menu manages its own open state; items close it on select via context.
//
// `triggerLabel` adds a hover/focus tooltip to the trigger, for the same reason as
// ResponsivePopover: a tooltip and a menu sharing one trigger only compose in one
// nesting order (tooltip trigger outermost), which the caller can't express when it
// hands us a bare element. Desktop only — touch has no hover, and the sheet is titled.
//
// `trigger` must be a single focusable element (rendered via `asChild`). Compose
// the body from <ResponsiveMenuItem> / <ResponsiveMenuSeparator> so each surface
// renders natively (DropdownMenuItem on desktop, a sheet row on mobile).

const MenuCtx = React.createContext<{ isMobile: boolean; close: () => void }>({
  isMobile: false,
  close: () => {},
});

export function ResponsiveMenu({
  trigger,
  triggerLabel,
  title,
  children,
  align = "end",
  contentClassName,
}: {
  trigger: React.ReactNode;
  triggerLabel?: string;
  // A string renders as a plain sheet heading; a node lets the caller compose a
  // richer header (e.g. an icon chip + the source note's title) for context once
  // the background is blurred behind the drawer.
  title?: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  contentClassName?: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const ctx = React.useMemo(() => ({ isMobile, close: () => setOpen(false) }), [isMobile]);

  if (isMobile) {
    return (
      <MenuCtx.Provider value={ctx}>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>{trigger}</DialogTrigger>
          {/* Slides up from the bottom (sheet-anim); auto-focus prevented so no
              stray keyboard on open. */}
          <DialogContent
            mobileSheet
            hideClose
            animClassName="sheet-anim"
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="flex flex-col gap-0 p-0 max-sm:min-h-[42vh]"
          >
            <SheetGrabber onClose={() => setOpen(false)} />
            <DialogTitle className={cn("px-4 pb-2 pt-1", !title && "sr-only", typeof title === "string" && "text-base")}>
              {title ?? "Actions"}
            </DialogTitle>
            <div className="flex flex-col p-2 pt-1">{children}</div>
          </DialogContent>
        </Dialog>
      </MenuCtx.Provider>
    );
  }

  return (
    <MenuCtx.Provider value={ctx}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <Tooltip label={triggerLabel}>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent align={align} className={contentClassName}>
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </MenuCtx.Provider>
  );
}

export function ResponsiveMenuItem({
  onSelect,
  disabled,
  danger,
  children,
}: {
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const { isMobile, close } = React.useContext(MenuCtx);
  if (isMobile) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { onSelect?.(); close(); }}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-base hover-scrim disabled:pointer-events-none disabled:opacity-50",
          danger && "text-destructive"
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      disabled={disabled}
      className={cn(danger && "text-destructive focus:text-destructive")}
    >
      {children}
    </DropdownMenuItem>
  );
}

export function ResponsiveMenuSeparator() {
  const { isMobile } = React.useContext(MenuCtx);
  if (isMobile) return <div className="mx-1 my-1 h-px bg-border" />;
  return <DropdownMenuSeparator />;
}
