import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

// Only ONE popover open at a time. Radix popovers each own their state, so two
// triggers can leave a cascade of stacked popovers on screen. We keep the currently
// open popover's "close me" callback in a single module-level slot (a stable ref, so
// identity comparisons are reliable); opening a new popover first closes whatever was
// open — which plays its normal pop-out — so the old fades away as the new appears.
let openPopoverCloser: React.MutableRefObject<() => void> | null = null;

// True for any Popover rendered inside another Popover's subtree (React context
// crosses Radix's portal, so this covers portaled content too). A NESTED popover —
// e.g. the folder/tag selects inside a card's Organize popover — must NOT join the
// single-open coordination: claiming the slot would close its own ancestor, which
// unmounts the nested popover along with it (the "Organize popover disappears" bug).
// Nested popovers are logically part of the open ancestor; the ancestor keeps the
// slot, and Radix's own layer stack handles dismissing the inner one.
const NestedPopoverContext = React.createContext(false);

// Wrapper over Radix's Root that plugs into the single-open coordinator. Works for
// both controlled (`open`/`onOpenChange` supplied) and uncontrolled popovers: for
// the latter it manages the open state internally so the coordinator can close it.
export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
  const nested = React.useContext(NestedPopoverContext);
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const actualOpen = isControlled ? open : uncontrolledOpen;

  // Stable per-instance "close me", refreshed each render so it always closes via
  // the right channel (parent's onOpenChange when controlled, local state otherwise).
  const closeRef = React.useRef<() => void>(() => {});
  closeRef.current = () => {
    if (isControlled) onOpenChange?.(false);
    else setUncontrolledOpen(false);
  };

  // Don't leave a dangling closer if this popover unmounts while open.
  React.useEffect(
    () => () => { if (openPopoverCloser === closeRef) openPopoverCloser = null; },
    []
  );

  const handleOpenChange = (next: boolean) => {
    // Nested popovers stay out of the coordinator entirely (see NestedPopoverContext).
    if (!nested) {
      if (next) {
        // Close the previously open popover (plays its exit) before claiming the slot.
        if (openPopoverCloser && openPopoverCloser !== closeRef) openPopoverCloser.current();
        openPopoverCloser = closeRef;
      } else if (openPopoverCloser === closeRef) {
        openPopoverCloser = null;
      }
    }
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <PopoverPrimitive.Root open={actualOpen} onOpenChange={handleOpenChange} {...props}>
      <NestedPopoverContext.Provider value={true}>{children}</NestedPopoverContext.Provider>
    </PopoverPrimitive.Root>
  );
}

export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Keep the panel inside the viewport on small screens: Radix shifts/flips it
      // away from the edges (collisionPadding), and the width is capped so a fixed
      // w-72 can never overflow a narrow phone.
      collisionPadding={collisionPadding}
      className={cn(
        "pop-anim z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-card p-3 text-card-foreground shadow-lg outline-none",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
