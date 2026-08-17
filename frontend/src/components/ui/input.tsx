import * as React from "react";
import { cn } from "@/lib/utils";

// The app's single text input. Everything that takes typed text — the passphrase
// dialogs, the new-folder and new-tag fields, the link URL box — renders this, so
// the focus ring, height, and disabled treatment stay identical everywhere.
//
// It forwards its ref and spreads every native <input> prop, so callers set
// `type`, `placeholder`, `value`, `autoFocus` and so on exactly as they would on a
// bare element; `className` is merged LAST (see cn) so a caller can override any
// individual style — e.g. the lock dialog bumps the height to 44px on phones —
// without having to fork the component.

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
