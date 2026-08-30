// Type "/" in the editor to insert a block.
//
// A heading, a list, a quote, a code block — without leaving the keyboard or
// reaching for the toolbar. TipTap's Suggestion plugin does the detection: it
// watches for the trigger character, tracks what is typed after it, and calls back
// as the query changes.
//
// The menu is rendered as PLAIN DOM rather than as a React portal. That is
// deliberate: it lives and dies with the caret, needs to be positioned against a
// ProseMirror coordinate on every keystroke, and would otherwise mean mounting a
// React tree inside the editor's own update cycle. Plain DOM keeps it in one file
// and out of React's way — the cost is that the icons have to be built as SVG
// strings (see iconSvg below) instead of rendered as components.
//
// Choosing an item deletes the "/query" text along with inserting the block, so the
// trigger never survives into the document.
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { Editor, Range } from "@tiptap/core";
import { NODES, type IconName } from "@/components/icons/nodes";
import { tOutsideReact, type MessageKey } from "@/lib/i18n";

// Build an inline SVG string from the shared lucide node geometry (same icons the
// toolbar uses) so the plain-DOM menu can show an icon before each label without a
// React render. Matches the toolbar's stroke look (24 viewBox, 2px round strokes).
function iconSvg(name: IconName): string {
  const inner = NODES[name]
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** One menu entry. `run` receives the editor and the RANGE covering the typed
 *  "/query", so each command can delete the trigger and apply itself in a single
 *  chain — otherwise the "/" would be left behind in the text. */
interface Item {
  /** A CATALOGUE KEY. The item table is module-level constant data, so English
   *  stored here would be frozen in whatever language was active at import. The
   *  label is resolved where the menu is drawn instead. */
  titleKey: MessageKey;
  icon: IconName;
  group: string; // adjacent items sharing a group render without a divider between
  run: (editor: Editor, range: Range) => void;
}

// Grouped: headings · lists · blocks · inline formatting. Icons reuse the toolbar's
// glyphs so the same action reads the same everywhere.
const ITEMS: Item[] = [
  { titleKey: "editor.heading1", icon: "Heading1", group: "heading", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run() },
  { titleKey: "editor.heading2", icon: "Heading2", group: "heading", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run() },
  { titleKey: "editor.heading3", icon: "Heading3", group: "heading", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run() },
  { titleKey: "editor.bulletList", icon: "List", group: "list", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { titleKey: "editor.numberedList", icon: "ListOrdered", group: "list", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { titleKey: "editor.checklist", icon: "ListChecks", group: "list", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { titleKey: "editor.quote", icon: "Quote", group: "block", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { titleKey: "editor.codeBlock", icon: "SquareCode", group: "block", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  // A divider is only ever inserted AT the cursor — there is no selection to
  // toggle it over — which is why it lives here and has no toolbar button. It has
  // existed in the document model all along (StarterKit ships it) but was reachable
  // only by typing three dashes from memory.
  { titleKey: "editor.divider", icon: "Minus", group: "block", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { titleKey: "editor.image", icon: "Image", group: "block", run: (e, r) => e.chain().focus().deleteRange(r).pickImage().run() },
  // Strikethrough is a MARK, not a block, so choosing it here with nothing selected
  // simply arms it: the next thing typed comes out struck through. That matches how
  // the markdown shortcut (~~…~~) already behaved, and gives the action a home for
  // anyone who reaches for "/" before reaching for the toolbar.
  { titleKey: "editor.strikethrough", icon: "Strikethrough", group: "format", run: (e, r) => e.chain().focus().deleteRange(r).toggleStrike().run() },
];

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    let el: HTMLDivElement | null = null;
    let selected = 0;
    let active: Item[] = [];
    let cmd: ((item: Item) => void) | null = null;

    const render = (rect?: DOMRect) => {
      if (!el) {
        el = document.createElement("div");
        el.className = "z-50 min-w-[13rem] rounded-md border bg-card p-1 shadow-md";
        el.style.position = "absolute";
        document.body.appendChild(el);
      }
      el.innerHTML = "";
      let lastGroup: string | null = null;
      active.forEach((item, i) => {
        // A hairline divider whenever the group changes (never before the first row).
        if (lastGroup !== null && item.group !== lastGroup) {
          const sep = document.createElement("div");
          sep.className = "my-1 h-px bg-border";
          el!.appendChild(sep);
        }
        lastGroup = item.group;
        const b = document.createElement("button");
        b.className =
          "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm " +
          (i === selected ? "bg-accent" : "");
        b.innerHTML =
          `<span class="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">${iconSvg(item.icon)}</span>` +
          `<span>${tOutsideReact(item.titleKey)}</span>`;
        b.onmousedown = (ev) => {
          ev.preventDefault();
          cmd?.(item);
        };
        el!.appendChild(b);
      });
      if (rect) {
        el.style.left = `${rect.left + window.scrollX}px`;
        el.style.top = `${rect.bottom + window.scrollY + 4}px`;
      }
    };

    const destroy = () => {
      el?.remove();
      el = null;
    };

    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        command: ({ editor, range, props }) => (props as Item).run(editor, range),
        items: ({ query, editor }) =>
          // Filtered on the TRANSLATED label, so typing "/tit" finds "Titre 1" in French.
          // Matching the key would mean the menu only ever searched in English.
          ITEMS.filter((i) => tOutsideReact(i.titleKey).toLowerCase().includes(query.toLowerCase()))
            // Images upload to a note, so a surface with no note behind it (the quick
            // composer) must not offer the action — an entry that silently does
            // nothing is worse than no entry. The uploader's presence in editor
            // storage is what says whether there is somewhere to upload to.
            .filter((i) => i.titleKey !== "editor.image" || !!editor.storage.image?.upload),
        render: () => ({
          onStart: (props) => {
            selected = 0;
            active = props.items as Item[];
            cmd = (item) => props.command(item);
            render(props.clientRect?.() ?? undefined);
          },
          onUpdate: (props) => {
            active = props.items as Item[];
            cmd = (item) => props.command(item);
            render(props.clientRect?.() ?? undefined);
          },
          onKeyDown: (props) => {
            if (props.event.key === "ArrowDown") {
              selected = (selected + 1) % active.length;
              render();
              return true;
            }
            if (props.event.key === "ArrowUp") {
              selected = (selected - 1 + active.length) % active.length;
              render();
              return true;
            }
            if (props.event.key === "Enter") {
              if (active[selected]) cmd?.(active[selected]);
              return true;
            }
            if (props.event.key === "Escape") {
              destroy();
              return true;
            }
            return false;
          },
          onExit: destroy,
        }),
      }),
    ];
  },
});
