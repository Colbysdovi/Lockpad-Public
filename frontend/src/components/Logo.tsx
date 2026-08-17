import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// The Lockpad mark, drawn inline rather than loaded as an image file — it is a
// handful of paths, it inherits the theme's colours automatically, and it stays
// sharp at any size with no asset request.
//
// On hover the padlock opens: the shackle lifts and tilts, the body gives a small
// bounce. A padlock that visibly unlocks is the whole idea of the product in one
// gesture — notes that are shut until you open them.
//
// Framer's `variants` drive this from a single `whileHover` on the parent, so every
// part animates as one coordinated movement instead of several independent ones.
export function Logo({ className }: { className?: string }) {
  return (
    <motion.div className={cn("flex select-none items-center gap-2", className)} initial="rest" whileHover="hover" animate="rest">
      <motion.svg
        width="26"
        height="26"
        viewBox="0 0 32 32"
        fill="none"
        variants={{ rest: { rotate: 0 }, hover: { rotate: [0, -6, 6, 0], transition: { duration: 0.5 } } }}
      >
        {/* Shackle — lifts and tilts on hover. */}
        <motion.path
          d="M10 14v-3a6 6 0 0 1 12 0v3"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
          variants={{
            rest: { y: 0, rotate: 0 },
            hover: { y: -3, rotate: -18, transition: { type: "spring", stiffness: 500, damping: 12 } },
          }}
          style={{ transformOrigin: "10px 11px" }}
        />
        {/* Body. */}
        <motion.rect
          x="7"
          y="13"
          width="18"
          height="13"
          rx="3.5"
          fill="var(--primary)"
          variants={{ rest: { scale: 1 }, hover: { scale: [1, 1.08, 1], transition: { duration: 0.4 } } }}
          style={{ transformOrigin: "16px 19px" }}
        />
        {/* Keyhole. */}
        <circle cx="16" cy="18.5" r="2" fill="var(--primary-foreground)" />
        <rect x="15.2" y="19" width="1.6" height="4" rx="0.8" fill="var(--primary-foreground)" />
      </motion.svg>
      {/* Hidden on the very smallest phones (<360px) to leave room for the
          header actions; the padlock alone still identifies the app. */}
      <span className="hidden text-[17px] font-bold tracking-tight min-[360px]:inline">Lockpad</span>
    </motion.div>
  );
}
