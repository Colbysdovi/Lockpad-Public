// A second way into the table actions, at the cell you are actually editing.
//
// The toolbar's table button works and is going nowhere — it is the keyboard path
// and the mobile path. What it costs on a desktop is a look away: the caret is in a
// cell, the actions are up in the toolbar, and the eye has to leave the work to find
// them. This puts a small handle beside the selected cell so the same actions
// (tableActions.ts — one list, both menus) are where the cursor already is.
//
// Three deliberate constraints, all from the PRD, and each one is why a piece of this
// looks the way it does:
//
//   SELECTION, NOT HOVER. The handle appears for the cell that holds the editing
//   selection, never for the cell under the pointer. A hover-triggered control can
//   sit over one cell while the caret is in another, and then "insert row above" is
//   a coin toss. Keying off the selection means the handle is never anywhere the
//   action would not apply.
//
//   NEVER A TAB STOP. It is `tabindex="-1"`, it lives on <body> rather than in the
//   editor, and its menu never takes focus — so a keyboard user tabbing between
//   cells encounters exactly what they encountered before this existed. It still
//   carries a role and a name, for the case where something focuses it anyway.
//
//   NEVER MOVES ANYTHING. Fixed-positioned on <body> and measured from the cell's
//   rect, so its appearing and disappearing cannot reflow the cell, the row, or the
//   table. This is the same shape as the block drag handle (blockDragHandle.ts),
//   which solves the same problem for top-level blocks.
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { nodeIconSvg } from "@/components/icons/nodes";
import { TABLE_ACTIONS } from "@/components/tableActions";
import { tOutsideReact } from "@/lib/i18n";

/** Keep in sync with .lockpad-table-cell-handle in index.css. */
const SIZE = 20;
/** Inset from the cell's right edge. It has to clear prosemirror-tables' column
 *  resize zone, which is the 5px either side of the gridline — a chip sitting on it
 *  would swallow the drag it belongs to. Six clears five. */
const INSET_X = 6;


class TableCellHandleView {
  private el: HTMLElement;
  private menu: HTMLElement | null = null;
  private raf = 0;
  /** Where the handle currently sits, so a frame that changed nothing writes nothing. */
  private at: { left: number; top: number } = { left: NaN, top: NaN };
  /** Pointer-only: on a touch device there is no hover, and the PRD's answer for
   *  that input mode is the toolbar's auto-scroll instead. Held as a live query so a
   *  device that gains or loses a mouse is not stuck with the wrong answer. */
  private fine = window.matchMedia?.("(hover: hover) and (pointer: fine)") ?? null;

  constructor(private view: EditorView, private editor: Editor) {
    this.el = document.createElement("div");
    this.el.className = "lockpad-table-cell-handle";
    this.el.setAttribute("contenteditable", "false");
    this.el.setAttribute("role", "button");
    // Not reachable by Tab — the toolbar is the keyboard path, and adding a second
    // stop between cells would change what a keyboard user walks through.
    this.el.setAttribute("tabindex", "-1");
    this.el.setAttribute("aria-haspopup", "menu");
    // Announced from the start, not only once the menu has been opened. `aria-haspopup`
    // says a menu exists; without this nothing says whether it is currently open, and a
    // screen reader reaching the chip in browse mode — which it can, independent of the
    // Tab sequence — would have the relationship without the state (WCAG 4.1.2).
    this.el.setAttribute("aria-expanded", "false");
    this.el.setAttribute("aria-label", tOutsideReact("editor.table.actions"));
    this.el.innerHTML = nodeIconSvg("Table", 14);
    this.el.style.display = "none";
    document.body.appendChild(this.el);

    // Pressing the handle must not move the caret out of the cell it belongs to, so
    // the press never reaches the browser's focus handling at all.
    this.el.addEventListener("mousedown", (e) => e.preventDefault());
    this.el.addEventListener("click", (e) => { e.preventDefault(); this.toggleMenu(); });

    this.sync();
  }

  update() {
    // Any transaction can move the selection, so the menu belongs to the cell it was
    // opened from and nowhere else.
    if (this.menu && !this.selectedCell()) this.closeMenu();
    this.sync();
  }

  destroy() {
    this.stopTracking();
    this.closeMenu();
    this.el.remove();
  }

  /** The rendered <td>/<th> holding the selection, or null — including when the DOM
   *  for it cannot be resolved. Returning null hides the handle, which is the right
   *  answer mid-transit: no handle beats a handle beside the wrong cell. */
  private selectedCell(): HTMLElement | null {
    const { $from } = this.view.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const name = $from.node(d).type.name;
      if (name === "tableCell" || name === "tableHeader") {
        const dom = this.view.nodeDOM($from.before(d));
        return dom instanceof HTMLElement ? dom : null;
      }
    }
    return null;
  }

  /** Is there a cell to point at right now? Drives whether the tracking loop runs. */
  private sync() {
    const cell = this.view.editable && this.fine?.matches ? this.selectedCell() : null;
    if (!cell) { this.hide(); return; }
    this.startTracking();
    this.place();
  }

  // The cell's rect is read every frame while the handle is up, which is what every
  // floating-UI library ends up doing and for the same reason: the anchor moves in
  // ways nothing announces. Scroll and resize can be listened for, but the note panel
  // opens on a Framer transform — no scroll, no resize, no layout change, no
  // transitionend, and the rect moves the whole way. Tried the event route first and
  // measured the result: the handle sat 43px above the cell once the panel settled.
  //
  // The cost is bounded by the thing that starts it — a caret inside a table cell —
  // and the loop stops the moment the selection leaves. Each frame is two rects and,
  // unless something actually moved, no writes at all.
  private startTracking() {
    if (this.raf) return;
    const tick = () => { this.raf = requestAnimationFrame(tick); this.place(); };
    this.raf = requestAnimationFrame(tick);
  }

  private stopTracking() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  /** Measure and place. Cheap enough to run per frame, and silent when nothing moved. */
  private place() {
    const cell = this.view.editable && this.fine?.matches ? this.selectedCell() : null;
    if (!cell) { this.hide(); return; }
    const rect = cell.getBoundingClientRect();

    // A fixed element on <body> is not clipped by the table's scrolling box, so a
    // cell scrolled out sideways would leave the handle floating beside the note
    // pointing at nothing. Ask whether the cell is still visible in its own box.
    const box = cell.closest<HTMLElement>(".tableWrapper");
    if (box) {
      const b = box.getBoundingClientRect();
      const gone =
        rect.right <= b.left || rect.left >= b.right || rect.bottom <= b.top || rect.top >= b.bottom;
      if (gone) { this.el.style.display = "none"; this.closeMenu(); return; }
    }

    // INSIDE the cell, at its top-right. The first version put it just above the cell
    // instead, to keep it off the cell's own text — and that was the wrong trade: a
    // control floating in the row above the one you are editing reads as pointing at
    // that row. Being unmistakably in the cell you are working in matters more than
    // the few pixels of a long first line it may cover, and the chip is opaque with a
    // shadow so what it covers reads as passing underneath rather than as a collision.
    //
    // Vertically centred on the cell rather than pinned to its top corner: on a
    // one-line cell — which most cells are — a top-pinned chip reads as hanging off
    // the corner, while a centred one sits on the line it belongs to and looks placed.
    // It grows downward from the top edge on a cell shorter than the chip, which
    // cannot happen at the current cell padding but costs one Math.max to rule out.
    //
    // The horizontal inset is the load-bearing one and stays: it keeps the chip off
    // the column resize zone on the gridline.
    const left = Math.round(rect.right - SIZE - INSET_X);
    const top = Math.round(Math.max(rect.top, rect.top + (rect.height - SIZE) / 2));
    if (left !== this.at.left || top !== this.at.top) {
      this.at = { left, top };
      this.el.style.left = `${left}px`;
      this.el.style.top = `${top}px`;
      if (this.menu) this.positionMenu();
    }
    this.el.style.display = "flex";
  }

  private hide() {
    this.stopTracking();
    this.closeMenu();
    this.el.style.display = "none";
    this.at = { left: NaN, top: NaN };
  }

  private toggleMenu() {
    if (this.menu) { this.closeMenu(); return; }
    const menu = document.createElement("div");
    menu.className = "lockpad-table-menu";
    menu.setAttribute("role", "menu");
    // Clicking an item must not blur the editor either — the actions run against the
    // selection, and the caret should still be in its cell afterwards.
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    TABLE_ACTIONS.forEach((action, i) => {
      // A break wherever the group changes — add, then move, then remove. Read off the
      // actions themselves, which is the same signal the toolbar's menu uses, so the
      // two menus cannot end up divided differently.
      if (i > 0 && action.group !== TABLE_ACTIONS[i - 1].group) {
        const sep = document.createElement("div");
        sep.className = "lockpad-table-menu-sep";
        menu.appendChild(sep);
      }
      const item = document.createElement("button");
      item.type = "button";
      // A <button> is focusable by default, so without this the open menu puts eleven
      // new stops into the page's Tab order — which is exactly what the handle's own
      // `tabindex="-1"` exists to prevent, and what this control's PRD forbids. The
      // menu is pointer-driven; the keyboard's path to these actions is the toolbar.
      item.tabIndex = -1;
      item.setAttribute("role", "menuitem");
      item.className = "lockpad-table-menu-item" + (action.danger ? " is-danger" : "");
      item.textContent = tOutsideReact(action.key);
      // A move at the edge of the table cannot go anywhere. Greyed out rather than
      // silently doing nothing, so the edge is visible before the press.
      item.disabled = action.enabled ? !action.enabled(this.editor) : false;
      item.addEventListener("click", (e) => {
        e.preventDefault();
        action.run(this.editor);
        this.closeMenu();
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    this.menu = menu;
    this.el.setAttribute("aria-expanded", "true");
    this.positionMenu();
    document.addEventListener("pointerdown", this.onDocPointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  private positionMenu() {
    const menu = this.menu;
    if (!menu) return;
    const h = this.el.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const mw = menu.offsetWidth;
    // Below the handle by default, above it when there is no room underneath, and
    // clamped on both axes so a table near an edge cannot push it off screen.
    const below = h.bottom + 6 + mh < window.innerHeight;
    const top = below ? h.bottom + 6 : h.top - 6 - mh;
    menu.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, h.right - mw)))}px`;
    menu.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - mh - 8, top)))}px`;
  }

  private closeMenu() {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.el.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.onDocPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
  }

  private onDocPointerDown = (e: PointerEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node) && e.target !== this.el) this.closeMenu();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); this.closeMenu(); }
  };
}

export const TableCellHandle = Extension.create({
  name: "tableCellHandle",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("tableCellHandle"),
        view: (view) => new TableCellHandleView(view, editor),
      }),
    ];
  },
});
