import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

// Radix tooltip provider — one instance at the app root gives every tooltip a
// shared open/close delay group (move between icon buttons and the next label
// shows instantly after the first). Styling lives in index.css (.tt-content).
export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  /** The label text. When empty/undefined the child renders unwrapped. */
  label?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Extra offset from the trigger, in px. */
  sideOffset?: number;
  children: React.ReactNode;
}

// Ergonomic wrapper: <Tooltip label="Archive"><button …/></Tooltip>. Safe to wrap
// conditionally — with no label it's a passthrough, so callers never branch.
export function Tooltip({ label, side = "top", align = "center", sideOffset = 6, children }: TooltipProps) {
  if (label === undefined || label === null || label === "") return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className="tt-content"
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
        >
          {label}
          <TooltipPrimitive.Arrow className="tt-arrow" width={11} height={6} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
