// The highlighter mark — text on a coloured wash.
//
// WHY THIS IS HAND-WRITTEN rather than `@tiptap/extension-highlight`. The official
// extension stores a raw CSS colour on the mark (`<mark style="background:#fef08a">`),
// which is exactly the wrong thing for an app with a dark theme: a pale yellow
// baked into the saved document is invisible on the espresso surface, and there is
// no way to correct it after the fact without rewriting every note. Storing the
// colour by NAME and resolving it through a CSS variable at render time means the
// same note reads correctly in both themes, and the palette can be re-tuned later
// without touching any stored content.
//
// It is also about forty lines, which is a poor trade for another dependency and
// another version to keep in step with the rest of the TipTap 2.x stack. The same
// reasoning produced smartLink.ts and blockDragHandle.ts.
//
// Serialization: `<mark data-color="amber">`. The Markdown exporter writes `==…==`
// and the print serializer writes a plain `<mark>` (see lib/tiptapMarkdown.ts and
// lib/tiptapHtml.ts).
import { Mark, markInputRule, mergeAttributes } from "@tiptap/core";
import { asHighlightColor, DEFAULT_HIGHLIGHT, type HighlightColor } from "@/lib/highlightColors";

// `==text==` as you type becomes a highlight, mirroring the Markdown this exports
// to. The capture group is the text; the surrounding markers are consumed.
const INPUT_RULE = /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))$/;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    highlight: {
      setHighlight: (attrs?: { color?: HighlightColor }) => ReturnType;
      toggleHighlight: (attrs?: { color?: HighlightColor }) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}

export const Highlight = Mark.create({
  name: "highlight",

  addAttributes() {
    return {
      color: {
        default: DEFAULT_HIGHLIGHT,
        // Read back through the narrowing helper so a document carrying a colour
        // this build no longer ships still renders, just in the default shade.
        parseHTML: (element) => asHighlightColor(element.getAttribute("data-color")),
        renderHTML: (attributes) => ({ "data-color": asHighlightColor(attributes.color) }),
      },
    };
  },

  parseHTML() {
    // `<mark>` from a paste (or from an older note) is adopted as a highlight; any
    // colour it carries in a `data-color` is kept, otherwise it becomes the default.
    return [{ tag: "mark" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlight:
        (attrs) => ({ commands }) => commands.setMark(this.name, attrs ?? {}),
      // Passing the SAME colour that is already applied clears the highlight —
      // that is what makes each swatch behave like a toggle in the picker. A
      // DIFFERENT colour re-marks the selection instead of unsetting it.
      toggleHighlight:
        (attrs) => ({ editor, commands }) => {
          const wanted = asHighlightColor(attrs?.color);
          const current = editor.isActive(this.name)
            ? asHighlightColor(editor.getAttributes(this.name).color)
            : null;
          if (current === wanted) return commands.unsetMark(this.name);
          return commands.setMark(this.name, { color: wanted });
        },
      unsetHighlight:
        () => ({ commands }) => commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleHighlight() };
  },

  addInputRules() {
    return [markInputRule({ find: INPUT_RULE, type: this.type })];
  },
});
