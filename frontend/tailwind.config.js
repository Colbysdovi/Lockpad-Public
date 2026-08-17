/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  // Only emit hover styles on devices that actually support hover (a real
  // pointer). On touch, `hover:`/`group-hover:` rules would otherwise fire on the
  // first tap (mobile hover emulation), which stole the tap that should open a
  // note and forced a second tap. Gating them means one tap opens; the card's
  // action bar reveals via long-press instead.
  future: { hoverOnlyWhenSupported: true },
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Colors reference CSS variables directly (raw hex values), matching the
      // Sou budget app's token approach.
      colors: {
        canvas: "var(--canvas)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        success: { DEFAULT: "var(--success)", foreground: "var(--success-foreground)" },
        warning: { DEFAULT: "var(--warning)", foreground: "var(--warning-foreground)" },
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Shadows are tinted with the palette's warm espresso rather than flat
      // black. `--shadow-color` is an "R G B" triplet that flips per theme (warm
      // brown on light, deep warm near-black on dark — see index.css), so every
      // `shadow-*` utility reads as part of the brown/beige/terracotta palette.
      // Geometry mirrors Tailwind's defaults; alphas are nudged up slightly since
      // a warm tint reads softer than pure black.
      boxShadow: {
        sm: "0 1px 2px 0 rgb(var(--shadow-color) / 0.08)",
        DEFAULT: "0 1px 3px 0 rgb(var(--shadow-color) / 0.12), 0 1px 2px -1px rgb(var(--shadow-color) / 0.12)",
        md: "0 4px 6px -1px rgb(var(--shadow-color) / 0.12), 0 2px 4px -2px rgb(var(--shadow-color) / 0.12)",
        lg: "0 10px 15px -3px rgb(var(--shadow-color) / 0.14), 0 4px 6px -4px rgb(var(--shadow-color) / 0.14)",
        xl: "0 20px 25px -5px rgb(var(--shadow-color) / 0.16), 0 8px 10px -6px rgb(var(--shadow-color) / 0.16)",
        "2xl": "0 25px 50px -12px rgb(var(--shadow-color) / 0.30)",
      },
    },
  },
  plugins: [],
};
