// Lockpad's keyboard shortcuts, and how to print a key for the machine you are on.
//
// ── Why this file is the only place shortcuts are described ──────────────────
//
// A shortcut reference is worth exactly as much as its accuracy. A list that is
// almost right is worse than no list, because it teaches people bindings that do
// not work and they stop trusting the rest. So every entry below carries a
// `source` naming the file that actually defines it. That is not documentation
// for its own sake: it is what makes this list checkable. If a binding moves or
// disappears, the pointer is the first place to look, and a reviewer can confirm
// an entry without hunting through the editor's extension graph.
//
// Everything here was read out of the real bindings rather than remembered — the
// app's own handler for the global ones, and the INSTALLED TipTap extension
// sources for the editor ones (node_modules/@tiptap/extension-*/src). TipTap's
// defaults are not folklore; they are in those files, and they are what shipped.

/** True when the user is on an Apple keyboard layout.
 *
 *  `userAgentData.platform` is the modern, non-deprecated answer and is the one to
 *  prefer; `navigator.platform` is the fallback that still works everywhere today.
 *
 *  When NEITHER can tell us, we deliberately resolve to false — the non-Mac form.
 *  That is not a coin flip. The non-Mac form spells its modifiers out ("Ctrl",
 *  "Alt"), so a Mac user who somehow lands on it reads something merely unidiomatic
 *  but still unambiguous. Guessing Mac the other way prints ⌘ and ⌥ at a reader
 *  whose keyboard has neither symbol on it, which is not readable at all. Fall back
 *  to the form that survives being wrong. */
function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const platform = uaPlatform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Resolved once at module load. Nobody swaps keyboards mid-session, and a
 *  constant keeps the top bar's hint and the reference from ever disagreeing
 *  because they sampled at different moments. */
export const IS_MAC = detectMac();

/** A single key in a combination.
 *
 *  "Mod" is the portable stand-in TipTap itself uses: Command on a Mac, Control
 *  everywhere else. Writing "Mod" rather than either real key is what lets one
 *  table serve both platforms instead of two tables drifting apart. */
export type ShortcutKey = string;

const MAC_LABELS: Record<string, string> = {
  Mod: "⌘",
  Alt: "⌥",
  Shift: "⇧",
  Enter: "↵",
  Tab: "⇥",
  Escape: "esc",
};

const PC_LABELS: Record<string, string> = {
  Mod: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Esc",
};

/** One key, printed for this machine. Anything not in the tables above (a letter,
 *  a digit, an arrow) is already the same on both and passes straight through. */
export function keyLabel(key: ShortcutKey): string {
  const table = IS_MAC ? MAC_LABELS : PC_LABELS;
  return table[key] ?? key;
}

/** A whole combination as one string, for places too small for separate keycaps —
 *  the search box's inline hint, a tooltip, an aria-label.
 *
 *  Mac writes modifiers as a run of symbols with nothing between them (⌘⇧S), which
 *  is the platform's own convention; everywhere else joins with "+" (Ctrl+Shift+S).
 *  Following each platform's habit matters more than internal consistency here,
 *  because the reader is comparing this against every other app on their machine,
 *  not against the rest of Lockpad. */
export function formatShortcut(keys: ShortcutKey[]): string {
  const labels = keys.map(keyLabel);
  return IS_MAC ? labels.join("") : labels.join("+");
}

/** Spoken form, for screen readers. The symbols are the problem: ⌘⇧S is announced
 *  as anything from "command shift S" to silence depending on the reader, so the
 *  accessible name spells the keys out in words and joins them with "plus". */
export function describeShortcut(keys: ShortcutKey[]): string {
  const spoken: Record<string, string> = {
    Mod: IS_MAC ? "Command" : "Control",
    Alt: IS_MAC ? "Option" : "Alt",
    Shift: "Shift",
    Enter: "Enter",
    Tab: "Tab",
    Escape: "Escape",
    "↑": "Up arrow",
    "↓": "Down arrow",
  };
  return keys.map((k) => spoken[k] ?? k).join(" plus ");
}

export interface Shortcut {
  keys: ShortcutKey[];
  action: string;
  /** Where this binding is actually defined — see the note at the top of the file. */
  source: string;
  /** Set when the binding only applies in a narrower situation than its group
   *  implies. Printed alongside the action so the list never over-promises. */
  when?: string;
}

export interface ShortcutGroup {
  title: string;
  description: string;
  shortcuts: Shortcut[];
}

/** Works anywhere in the app — read straight off the window keydown handler in
 *  Layout.tsx, which is the single place global bindings live. */
const GLOBAL: Shortcut[] = [
  { keys: ["Mod", "K"], action: "Open search", source: "Layout.tsx" },
  { keys: ["Mod", "N"], action: "New note", source: "Layout.tsx" },
  { keys: ["Mod", "\\"], action: "Show or hide the sidebar", source: "Layout.tsx" },
  {
    keys: ["Escape"],
    action: "Close the note",
    source: "Layout.tsx",
    // The handler guards on `noteId`, so this does nothing with no note open.
    // Saying so is the difference between a reference and a wish.
    when: "while a note is open",
  },
];

/** Formatting marks. All TipTap defaults except the highlight, which is ours.
 *
 *  Note what is NOT here: TipTap ships a Cyrillic alias for undo/redo (Mod-я) and
 *  a Windows-flavoured Mod-Y for redo. Both are real and both are omitted — a
 *  reference earns its keep by listing the binding a reader should learn, not
 *  every alias that happens to resolve. */
const EDITOR_FORMATTING: Shortcut[] = [
  { keys: ["Mod", "B"], action: "Bold", source: "@tiptap/extension-bold" },
  { keys: ["Mod", "I"], action: "Italic", source: "@tiptap/extension-italic" },
  { keys: ["Mod", "Shift", "S"], action: "Strikethrough", source: "@tiptap/extension-strike" },
  { keys: ["Mod", "E"], action: "Inline code", source: "@tiptap/extension-code" },
  { keys: ["Mod", "Shift", "H"], action: "Highlight", source: "components/highlight.ts" },
];

/** Block-level structure. */
const EDITOR_STRUCTURE: Shortcut[] = [
  // StarterKit is configured with levels [1, 2, 3], so only those three exist —
  // extension-heading binds Mod-Alt-<level> for each CONFIGURED level, which is
  // why there is no Mod+Alt+4 here even though the extension can produce one.
  { keys: ["Mod", "Alt", "1"], action: "Heading 1", source: "@tiptap/extension-heading" },
  { keys: ["Mod", "Alt", "2"], action: "Heading 2", source: "@tiptap/extension-heading" },
  { keys: ["Mod", "Alt", "3"], action: "Heading 3", source: "@tiptap/extension-heading" },
  { keys: ["Mod", "Alt", "0"], action: "Plain paragraph", source: "@tiptap/extension-paragraph" },
  { keys: ["Mod", "Shift", "8"], action: "Bulleted list", source: "@tiptap/extension-bullet-list" },
  { keys: ["Mod", "Shift", "7"], action: "Numbered list", source: "@tiptap/extension-ordered-list" },
  { keys: ["Mod", "Shift", "9"], action: "Checklist", source: "@tiptap/extension-task-list" },
  { keys: ["Mod", "Shift", "B"], action: "Quote", source: "@tiptap/extension-blockquote" },
  // Kept deliberately. StarterKit's own codeBlock is switched off in Editor.tsx in
  // favour of the syntax-highlighted one, and the obvious conclusion is that its
  // shortcut died with it — but CodeBlockLowlight is `CodeBlock.extend(...)` and
  // does not override addKeyboardShortcuts, so it INHERITS this binding and the
  // key still works. Verified in the installed source, not assumed either way.
  { keys: ["Mod", "Alt", "C"], action: "Code block", source: "@tiptap/extension-code-block-lowlight" },
  { keys: ["Tab"], action: "Indent the list item", source: "@tiptap/extension-list-item", when: "inside a list" },
  { keys: ["Shift", "Tab"], action: "Outdent the list item", source: "@tiptap/extension-list-item", when: "inside a list" },
  { keys: ["Alt", "↑"], action: "Move this block up", source: "components/blockDragHandle.ts" },
  { keys: ["Alt", "↓"], action: "Move this block down", source: "components/blockDragHandle.ts" },
  { keys: ["Shift", "Enter"], action: "Line break without a new paragraph", source: "@tiptap/extension-hard-break" },
  { keys: ["Mod", "Z"], action: "Undo", source: "@tiptap/extension-history" },
  { keys: ["Mod", "Shift", "Z"], action: "Redo", source: "@tiptap/extension-history" },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    description: "These work from any screen in Lockpad.",
    shortcuts: GLOBAL,
  },
  {
    title: "Writing a note",
    description: "These work while the cursor is in a note.",
    shortcuts: [...EDITOR_FORMATTING, ...EDITOR_STRUCTURE],
  },
];
