import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

// Radix dropdown menu, dressed in the Lockpad tokens. Radix supplies the hard
// parts — keyboard navigation, focus trapping, click-outside, correct ARIA roles —
// and these wrappers only add styling, so behaviour stays standard everywhere.
//
// Note that most menus in the app do NOT use this directly: they go through
// ResponsiveMenu, which renders this on desktop and a bottom sheet on phones (a
// desktop dropdown is a poor fit for a thumb). Reach for this one only when a menu
// should stay a dropdown on every screen size.
//
// Root and Trigger are re-exported unchanged — there is nothing to style on them.
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  // Portalled to <body> so the panel is never clipped by an ancestor's overflow
  // (note cards, the sidebar and the virtualized list all clip their children).
  // `pop-anim` is the shared open/close motion used by every popover in the app.
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "pop-anim z-50 min-w-[10rem] overflow-hidden rounded-md border bg-card p-1 text-card-foreground shadow-md",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  // One row. `focus:` rather than `hover:` is deliberate — Radix moves DOM focus as
  // you arrow through the list, so styling focus highlights the keyboard selection
  // and the mouse hover with a single rule.
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
