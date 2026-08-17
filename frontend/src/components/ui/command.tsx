import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "@/components/icons";
import { cn } from "@/lib/utils";

// cmdk-based command palette / searchable list, styled to the Lockpad tokens.
//
// cmdk owns the behaviour: it filters items as you type, moves a "selected" cursor
// with the arrow keys, and fires onSelect on Enter — so these wrappers are purely
// cosmetic. Used by the global search palette (Cmd+K) and by the [[ note-link
// picker inside the editor.
//
// The pieces fit together as: Command > CommandInput + CommandList > CommandItem,
// with CommandEmpty rendering when the filter matches nothing.
export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn("flex w-full flex-col overflow-hidden rounded-md bg-card text-card-foreground", className)}
    {...props}
  />
));
Command.displayName = "Command";

// The query field, with a magnifier and a hairline beneath it. The wrapper div is
// what carries the border, so the input itself can stay transparent and borderless
// and the whole row reads as one control.
export function CommandInput({ className, ...props }: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b px-2">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn("flex h-9 w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground", className)}
        {...props}
      />
    </div>
  );
}

// Re-exported as-is: the list scroller needs no styling of its own (callers set
// max-height on CommandList where scrolling is wanted).
export const CommandList = CommandPrimitive.List;

export function CommandEmpty(props: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-4 text-center text-sm text-muted-foreground" {...props} />;
}

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  // cmdk marks the cursor row with data-selected, which covers BOTH arrow-key
  // navigation and mouse hover — so one rule styles both, and the keyboard and the
  // mouse can never disagree about which row is about to be chosen.
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
      "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = "CommandItem";
