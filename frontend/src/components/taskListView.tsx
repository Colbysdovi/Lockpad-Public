import { useEffect, useState } from "react";
import TaskList, { type TaskListOptions } from "@tiptap/extension-task-list";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ChevronRight } from "@/components/icons";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// A checklist, plus the fold of its own completed items.
//
// ── Where this used to live, and why it moved ───────────────────────────────
//
// Checked items are hidden from the list (CSS, see `.collapse-checked` in
// index.css) and offered back behind a fold. That fold used to be a single
// footer at the very bottom of the note, collecting every checked item in the
// document into one pile.
//
// It read as a good idea and was a bad one in use. Ticking something sent it to
// a place that had nothing to do with where it came from: a note with two
// checklists poured both into one list, and even with a single checklist the
// fold sat below the editor's 60vh minimum height, which put it most of a
// screen away from the list it belonged to. Completed work is still part of the
// list it was part of — you look at it to remember what you already did, which
// only means anything next to what is left.
//
// So the fold now belongs to a list rather than to a note, and renders directly
// underneath it, in the document's own flow. Any text after the checklist stays
// after the fold, where it was written.
//
// ── The shape of the DOM, which took two goes ───────────────────────────────
//
// The obvious spelling — `<NodeViewContent as="ul">` — produces `ul > div > li`,
// because TipTap creates its own element to hold a node's content and puts it
// inside whatever you marked as the content host. That renders correctly and is
// broken where it counts: `li` elements that are not children of their `ul` are
// not a list to a screen reader, so a checklist would simply stop being announced
// as one. It looked perfect in a screenshot, which is the only reason it survived
// long enough to be caught by reading the DOM.
//
// So the element TipTap creates IS the `ul` (`contentDOMElementTag`), and the host
// it goes inside is a plain `div` set to `display: contents`, which takes it out of
// both the layout and the accessibility tree. What is left is
// `div.lp-task-list > ul > li`, with the fold as the `ul`'s sibling: valid nesting,
// real list semantics, and the fold outside the list rather than pretending to be
// an item of it.
//
// ── Why a node view ─────────────────────────────────────────────────────────
//
// "Directly underneath the list" is a position inside the document, and the
// document's DOM belongs to ProseMirror — appending anything to it from outside
// would either be wiped on the next redraw or, worse, be treated as editable
// content. A node view is the sanctioned way to render something that travels
// with a node without being part of it, which is why the image node already uses
// one. The fold is marked `contentEditable={false}` so the caret walks past it
// rather than into it.
//
// Nothing here changes the document's shape. Checked items stay exactly where
// they are written; this only ever flips a `checked` attribute, so unticking
// something puts it back at its own position and indent rather than at the end.

function TaskListView({ editor, node, getPos, extension }: NodeViewProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const pos = typeof getPos === "function" ? getPos() : undefined;

  // TipTap builds the `ul` itself, so it carries none of the attributes the plain
  // extension's `renderHTML` would give it. Stamping the marker back on means one
  // set of CSS rules covers both this and the preview's plain checklist, rather
  // than every rule needing a second selector that could later be forgotten.
  useEffect(() => {
    if (pos == null) return;
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) dom.querySelector("ul")?.setAttribute("data-type", "taskList");
  }, [editor, pos]);

  // A nested checklist renders no fold of its own. Its completed items are
  // already counted by the list it sits inside, and a fold opening inside a
  // single task item would be a second, smaller pile in the middle of the first.
  const nested =
    pos != null && /list$|item$/i.test(editor.state.doc.resolve(pos).parent.type.name);

  // The fold only makes sense while something is being folded. `collapseChecked`
  // is what puts the `.collapse-checked` class on the editor, and that class is
  // what hides completed items from the list — with it off they are shown inline,
  // and listing them again down here would be the same items twice.
  const folding = extension.options.showCheckedFold !== false;

  // Read straight off the node on every render. The node view re-renders when its
  // node changes, which is exactly when an item is ticked or unticked, so there is
  // nothing to subscribe to and nothing that can fall out of step with the
  // document.
  //
  // `descendants`, not direct children: a nested checklist's completed items
  // belong to this fold, since the nested list does not draw one.
  const items: { pos: number; text: string }[] = [];
  if (pos != null) {
    node.descendants((child, offset) => {
      if (child.type.name === "taskItem" && child.attrs.checked) {
        // +1 steps over the list's own opening token to reach its content.
        items.push({ pos: pos + 1 + offset, text: child.textContent });
      }
      return true;
    });
  }

  const uncheck = (at: number) => {
    if (!editor.isEditable) return;
    // Positions are recomputed on every render, but a click can still land on a
    // stale one if the document changed between paint and pointerup.
    if (editor.state.doc.nodeAt(at)?.type.name !== "taskItem") return;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(at, "checked", false));
  };

  return (
    <NodeViewWrapper className="lp-task-list">
      {/* `contents` — see the note above: this host must not exist as a box. */}
      <NodeViewContent className="contents" />
      {folding && !nested && items.length > 0 && (
        <div className="lp-task-checked" contentEditable={false}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-muted-foreground hover-scrim hover:text-foreground"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
            {t("editor.checked.summary", { count: items.length })}
          </button>
          {open && (
            <ul className="mt-1 flex flex-col gap-1.5 pl-1.5">
              {items.map((it) => (
                <li key={it.pos} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked
                    disabled={!editor.isEditable}
                    onChange={() => uncheck(it.pos)}
                    aria-label={t("editor.checked.uncheck", {
                      item: it.text || t("editor.checked.untitled"),
                    })}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                    style={{ accentColor: "var(--primary)" }}
                  />
                  <span className="text-sm text-muted-foreground line-through">{it.text || " "}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** The checklist extension the EDITOR uses. Card previews keep the plain one —
 *  they are inert miniatures, and a fold nobody can open is just a line of text
 *  taking up room a preview does not have. */
interface TaskListWithCheckedOptions extends TaskListOptions {
  /** Whether completed items are being hidden from the list, and therefore need
   *  somewhere to be offered back. Read once when the editor is built, which is
   *  also when the class that does the hiding is decided. */
  showCheckedFold: boolean;
}

export const TaskListWithChecked = TaskList.extend<TaskListWithCheckedOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      showCheckedFold: true,
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskListView, { contentDOMElementTag: "ul" });
  },
});
