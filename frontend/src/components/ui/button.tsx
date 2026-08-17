import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// The app's button, in the handful of shapes it is allowed to take.
//
// Written locally rather than pulled from a component library — like every other
// primitive in this folder — so that nothing is fetched from a CDN at runtime. That
// is the same zero-outbound-request rule that governs the fonts and the icons.
//
// The variants are a deliberately short list, and the reason to keep it short is
// that each one carries meaning:
//   default      the primary action of a screen. One per view, ideally.
//   destructive  deletes something. Distinct RED, not the terracotta primary, so a
//                delete can never be mistaken for the safe action next to it.
//   outline      a secondary action of equal standing (Cancel next to Confirm).
//   ghost        a quiet action, mostly icon buttons in bars and toolbars.
//   secondary    a filled but non-primary action; rare.
//   link         looks like text; for "learn more"-style asides.
//
// The sizes are written MOBILE-FIRST: the bare class is the phone size and `sm:`
// shrinks it for pointer devices. That is the opposite of how the rest of this file
// reads, and it is deliberate — a finger needs roughly 44px of target, a cursor
// needs none of that, and the phone is the case that goes wrong silently. This used
// to be a single viewport-agnostic height (`h-9`, 36px everywhere) with ten
// individual callers patching `h-11 sm:h-9` back on by hand, which left the other
// twenty-eight buttons in the app under-sized on phones with nothing to indicate it.
// Putting the rule in the variant means a new button is correct by default rather
// than correct if somebody remembers.
//
// `className` merges LAST (see cn), so a caller can still override any single
// property without needing a new variant — including the callers that already spell
// out `h-11 sm:h-9`, which now simply restate what they would get anyway.
// Exported so a real <a> can wear the same clothes. A control that NAVIGATES has
// to be a link — for middle-click, for "open in new tab", for the status bar
// preview — and dressing it as a button is a styling question, not a semantic one.
// Why the hover backgrounds are spelled `color-mix(...)` and not `hover:bg-primary/90`:
// every palette colour in this project is a plain `var()` holding a finished hex
// (index.css), and Tailwind can only slice an alpha out of a colour expressed as
// separate channels. Given a hex-in-a-var it emits NO RULE AT ALL — so the tidy-looking
// `/90` spellings these replaced meant the app's filled buttons had no hover response
// anywhere, silently, rather than a wrong one. `color-mix(... , transparent)` is the
// same maths (90% colour, 10% see-through) and is the form the --surface-* tokens
// already use. Same trap as the one documented in SecuritySettings.tsx.
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary)_90%,transparent)]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-[color-mix(in_srgb,var(--destructive)_90%,transparent)]",
        outline: "border border-input bg-background hover-scrim hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_90%,transparent)]",
        ghost: "hover-scrim hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2 sm:h-9 sm:px-4",
        sm: "h-9 rounded-md px-4 text-xs sm:h-8 sm:px-3",
        lg: "h-12 rounded-md px-8 sm:h-10",
        icon: "h-11 w-11 sm:h-9 sm:w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  )
);
Button.displayName = "Button";
