import { tOutsideReact, type MessageKey } from "@/lib/i18n";
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
    "↑": tOutsideReact("shortcut.key.up"),
    "↓": tOutsideReact("shortcut.key.down"),
  };
  return keys.map((k) => spoken[k] ?? k).join(" plus ");
}

export interface Shortcut {
  keys: ShortcutKey[];
  /** A CATALOGUE KEY, not the words. This table is module-level constant data, so
   *  English stored here would be frozen at import time and the whole reference
   *  would stay in whatever language was active when the module first loaded. The
   *  dialog translates it at render instead. */
  action: MessageKey;
  /** Where this binding is actually defined — see the note at the top of the file. */
  source: string;
  /** Set when the binding only applies in a narrower situation than its group
   *  implies. Printed alongside the action so the list never over-promises. */
  when?: MessageKey;
}

export interface ShortcutGroup {
  /** Catalogue keys, for the same reason as Shortcut.action above. */
  title: MessageKey;
  description: MessageKey;
  shortcuts: Shortcut[];
}

/** Works anywhere in the app — read straight off the window keydown handler in
 *  Layout.tsx, which is the single place global bindings live. */
const GLOBAL: Shortcut[] = [
  { keys: ["Mod", "K"], action: "shortcut.openSearch", source: "Layout.tsx" },
  { keys: ["Mod", "N"], action: "shortcut.newNote", source: "Layout.tsx" },
  { keys: ["Mod", "\\"], action: "shortcut.toggleSidebar", source: "Layout.tsx" },
  {
    keys: ["Escape"],
    action: "shortcut.closeNote",
    source: "Layout.tsx",
    // The handler guards on `noteId`, so this does nothing with no note open.
    // Saying so is the difference between a reference and a wish.
    when: "shortcut.when.note",
  },
];

/** Formatting marks. All TipTap defaults except the highlight, which is ours.
 *
 *  Note what is NOT here: TipTap ships a Cyrillic alias for undo/redo (Mod-я) and
 *  a Windows-flavoured Mod-Y for redo. Both are real and both are omitted — a
 *  reference earns its keep by listing the binding a reader should learn, not
 *  every alias that happens to resolve. */
const EDITOR_FORMATTING: Shortcut[] = [
  { keys: ["Mod", "B"], action: "shortcut.bold", source: "@tiptap/extension-bold" },
  { keys: ["Mod", "I"], action: "shortcut.italic", source: "@tiptap/extension-italic" },
  { keys: ["Mod", "Shift", "S"], action: "shortcut.strikethrough", source: "@tiptap/extension-strike" },
  { keys: ["Mod", "E"], action: "shortcut.inlineCode", source: "@tiptap/extension-code" },
  { keys: ["Mod", "Shift", "H"], action: "shortcut.highlight", source: "components/highlight.ts" },
];

/** Block-level structure. */
const EDITOR_STRUCTURE: Shortcut[] = [
  // StarterKit is configured with levels [1, 2, 3], so only those three exist —
  // extension-heading binds Mod-Alt-<level> for each CONFIGURED level, which is
  // why there is no Mod+Alt+4 here even though the extension can produce one.
  { keys: ["Mod", "Alt", "1"], action: "shortcut.heading1", source: "@tiptap/extension-heading" },
  { keys: ["Mod", "Alt", "2"], action: "shortcut.heading2", source: "@tiptap/extension-heading" },
  { keys: ["Mod", "Alt", "3"], action: "shortcut.heading3", source: "@tiptap/extension-heading" },
  { keys: ["Mod", "Alt", "0"], action: "shortcut.paragraph", source: "@tiptap/extension-paragraph" },
  { keys: ["Mod", "Shift", "8"], action: "shortcut.bulletedList", source: "@tiptap/extension-bullet-list" },
  { keys: ["Mod", "Shift", "7"], action: "shortcut.numberedList", source: "@tiptap/extension-ordered-list" },
  { keys: ["Mod", "Shift", "9"], action: "shortcut.checklist", source: "@tiptap/extension-task-list" },
  { keys: ["Mod", "Shift", "B"], action: "shortcut.quote", source: "@tiptap/extension-blockquote" },
  // Kept deliberately. StarterKit's own codeBlock is switched off in Editor.tsx in
  // favour of the syntax-highlighted one, and the obvious conclusion is that its
  // shortcut died with it — but CodeBlockLowlight is `CodeBlock.extend(...)` and
  // does not override addKeyboardShortcuts, so it INHERITS this binding and the
  // key still works. Verified in the installed source, not assumed either way.
  { keys: ["Mod", "Alt", "C"], action: "shortcut.codeBlock", source: "@tiptap/extension-code-block-lowlight" },
  { keys: ["Tab"], action: "shortcut.indent", source: "@tiptap/extension-list-item", when: "shortcut.when.list" },
  { keys: ["Shift", "Tab"], action: "shortcut.outdent", source: "@tiptap/extension-list-item", when: "shortcut.when.list" },
  { keys: ["Alt", "↑"], action: "shortcut.moveBlockUp", source: "components/blockDragHandle.ts" },
  { keys: ["Alt", "↓"], action: "shortcut.moveBlockDown", source: "components/blockDragHandle.ts" },
  { keys: ["Shift", "Enter"], action: "shortcut.lineBreak", source: "@tiptap/extension-hard-break" },
  { keys: ["Mod", "Z"], action: "shortcut.undo", source: "@tiptap/extension-history" },
  { keys: ["Mod", "Shift", "Z"], action: "shortcut.redo", source: "@tiptap/extension-history" },
];

/** The quick-note bar at the bottom of every list page.
 *
 *  All three are listed, and listing all three is the point. Enter used to create a
 *  note AND open it; it now creates without opening, and Mod+Enter is what opens.
 *  Documenting only the new binding would leave a reader who already knows this app
 *  assuming Enter still does what it used to — the one misreading this reference
 *  exists to prevent.
 *
 *  Shift+Enter is here for the same reason, even though it is the one thing that did
 *  NOT change: it is what makes a multi-line quick note possible, it is the reason
 *  "create and open" is bound to Mod rather than Shift, and a reference that lists
 *  two of a field's three Enter behaviours is a reference that reads as complete
 *  while being wrong. */
const COMPOSER: Shortcut[] = [
  {
    keys: ["Enter"],
    action: "shortcut.createStay",
    source: "components/NoteBar.tsx",
    when: "shortcut.when.composer",
  },
  {
    keys: ["Mod", "Enter"],
    action: "shortcut.createOpen",
    source: "components/NoteBar.tsx",
    when: "shortcut.when.composer",
  },
  {
    keys: ["Shift", "Enter"],
    action: "shortcut.newLine",
    source: "components/NoteBar.tsx",
    when: "shortcut.when.composer",
  },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "shortcut.group.anywhere",
    description: "shortcut.group.anywhere.blurb",
    shortcuts: GLOBAL,
  },
  {
    title: "shortcut.group.composer",
    description: "shortcut.group.composer.blurb",
    shortcuts: COMPOSER,
  },
  {
    title: "shortcut.group.note",
    description: "shortcut.group.note.blurb",
    shortcuts: [...EDITOR_FORMATTING, ...EDITOR_STRUCTURE],
  },
];
