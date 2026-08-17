// Notion-style block drag-to-reorder (PRD: prd-block-drag.md). A ProseMirror
// plugin (added via a TipTap Extension, mirroring SlashCommand) renders a
// floating drag handle in the left margin of the hovered block (desktop) or the
// long-pressed block (mobile), and lets the user reorder that block among its
// current siblings only — no indent/outdent in v1.
//
// The drag is pointer-events based (one code path for mouse AND touch — native
// HTML5 DnD can't work on touch), and every move is a single ProseMirror
// transaction (delete-then-insert), so it lands in the normal undo history and
// nested checklist subtrees move as a unit for free.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

interface Block {
  node: PMNode;
  pos: number; // position just before the node
  depth: number;
}

// The draggable block at a document position: the nearest ancestor whose parent
// is the doc (a top-level block) OR a list container (a list item). Schema-
// generic — any future top-level node type is draggable with no change here, and
// list items are detected structurally (parent node name ends in "list").
function blockAt(view: EditorView, pos: number): Block | null {
  const $pos = view.state.doc.resolve(pos);
  for (let d = $pos.depth; d >= 1; d--) {
    const parent = $pos.node(d - 1);
    if (parent.type.name === "doc" || /list$/i.test(parent.type.name)) {
      return { node: $pos.node(d), pos: $pos.before(d), depth: d };
    }
  }
  return null;
}

// The draggable block under a SCREEN POINT.
//
// The obvious implementation — `posAtCoords` then `blockAt` — has a blind spot, and
// it is the reason images and smart-link cards used to have no drag handle at all.
// `posAtCoords` works by asking the browser for the text caret position at that
// point, and inside a node view rendered `contenteditable="false"` (any custom block:
// a picture, a link card) there IS no caret position, so it returns null and the
// caller gives up. Every ordinary paragraph got a handle; every custom block silently
// did not.
//
// So when the caret lookup comes back empty, ask the DOM instead: find the element
// under the cursor, walk up to the node view's own root, and match that element
// against the blocks in the document by their rendered DOM. Slightly more work, but
// only on the path where the cheap answer failed — and it makes the handle
// schema-generic in practice, not just in principle.
function blockAtPoint(view: EditorView, clientX: number, clientY: number): Block | null {
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (coords) {
    const block = blockAt(view, coords.pos);
    if (block) return block;
  }
  const el = document.elementFromPoint(clientX, clientY);
  if (!(el instanceof HTMLElement) || !view.dom.contains(el)) return null;
  return blockForDom(view, el);
}

// Walk up from `el` to the outermost element that IS a block's rendered DOM, and
// return that block. Compares against `view.nodeDOM(pos)` rather than reading any
// marker attribute, so it holds for every node view without them opting in.
function blockForDom(view: EditorView, el: HTMLElement): Block | null {
  const { doc } = view.state;
  const candidates = new Map<HTMLElement, Block>();
  doc.descendants((node, pos, parent) => {
    if (!parent) return true;
    const isBlock = parent.type.name === "doc" || /list$/i.test(parent.type.name);
    if (!isBlock) return true;
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      candidates.set(dom, { node, pos, depth: doc.resolve(pos).depth + 1 });
    }
    // Keep descending: list items are blocks too, and they live inside lists.
    return true;
  });

  // Nearest match wins, so hovering a list item inside a list picks the ITEM — the
  // same choice `blockAt` makes by walking up from the innermost position.
  for (let node: HTMLElement | null = el; node && node !== view.dom; node = node.parentElement) {
    const block = candidates.get(node);
    if (block) return block;
  }
  return null;
}

function domRect(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
}

const GRIP = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="5" r="1.7"/><circle cx="15" cy="5" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="19" r="1.7"/><circle cx="15" cy="19" r="1.7"/></svg>`;
const PLUS = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;


// ── Moving a block among its siblings ────────────────────────────────────────
//
// One implementation behind every way of reordering: the keyboard shortcut, the
// handle's menu, and the drag itself. They differ only in how the destination is
// chosen; what happens to the document is the same single transaction, so a move is
// one undo step however it was asked for.

interface Sibling { pos: number; size: number }

/** Every child of a block's parent, in document order, with its start position. */
function siblingsOf(view: EditorView, block: Block): Sibling[] {
  const $b = view.state.doc.resolve(block.pos);
  const parentDepth = block.depth - 1;
  const parent = $b.node(parentDepth);
  let pos = $b.start(parentDepth);
  const out: Sibling[] = [];
  parent.forEach((child) => {
    out.push({ pos, size: child.nodeSize });
    pos += child.nodeSize;
  });
  return out;
}

/** Move `block` so it starts at `insertPos`. Returns false when that is a no-op. */
function performBlockMove(view: EditorView, block: Block, insertPos: number, keepCaret: boolean): boolean {
  const from = block.pos;
  const to = block.pos + block.node.nodeSize;
  if (insertPos >= from && insertPos <= to) return false; // dropped onto itself
  const tr = view.state.tr.delete(from, to);
  const mapped = tr.mapping.map(insertPos);
  tr.insert(mapped, block.node);
  // Keep the caret with the block it just moved, so a run of Alt+Arrow presses walks
  // the same paragraph up the page instead of moving one block and then its neighbour.
  // Skipped for drags, where the pointer — not the caret — is the thing being followed,
  // and stealing focus back into the editor would close whatever menu is open.
  if (keepCaret) {
    const inside = TextSelection.near(tr.doc.resolve(mapped + 1));
    tr.setSelection(inside);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Move the block holding the selection one place up or down. The keyboard path. */
function moveBlockBy(view: EditorView, direction: -1 | 1): boolean {
  if (!view.editable) return false;
  const block = blockAt(view, view.state.selection.from);
  if (!block) return false;
  const sibs = siblingsOf(view, block);
  const index = sibs.findIndex((s) => s.pos === block.pos);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sibs.length) {
    announce(direction < 0 ? "Already the first block" : "Already the last block");
    return true; // handled: swallow the key so it doesn't also move the caret
  }
  const insertPos = direction < 0 ? sibs[target].pos : sibs[target].pos + sibs[target].size;
  const moved = performBlockMove(view, block, insertPos, true);
  if (moved) announce(direction < 0 ? "Block moved up" : "Block moved down");
  view.focus();
  return true;
}

// A move done by key or menu has no visible motion of its own to explain it, so it is
// spoken instead. One region for the whole app; polite, so it waits its turn.
let liveRegion: HTMLElement | null = null;
function announce(message: string) {
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.className = "sr-only";
    liveRegion.setAttribute("aria-live", "polite");
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = message;
}

// Which DragHandleView belongs to which editor, so the plugin's own DOM handlers
// (dragover/drop, which must be plugin props to run BEFORE ProseMirror's built-in
// drop handling) can reach the view that is tracking the drag.
const views = new WeakMap<EditorView, DragHandleView>();

export const BlockDragHandle = Extension.create({
  name: "blockDragHandle",

  // Track C: the deterministic path. No pointer, no gesture, nothing to miss — and
  // until now the only way to reorder a block was to be holding a mouse.
  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": () => moveBlockBy(this.editor.view, -1),
      "Alt-ArrowDown": () => moveBlockBy(this.editor.view, 1),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockDragHandle"),
        view: (view) => new DragHandleView(view),
        props: {
          // Registered as plugin props rather than plain listeners because ProseMirror
          // consults these BEFORE its own drag handling; a listener added afterwards
          // would fire second and PM would already have pasted the dragged content.
          handleDOMEvents: {
            dragover: (view, event) => views.get(view)?.onDragOver(event as DragEvent) ?? false,
            drop: (view, event) => views.get(view)?.onDrop(event as DragEvent) ?? false,
          },
        },
      }),
    ];
  },
});

/** How close to a scroller's edge the pointer must get before the page follows it. */
const AUTOSCROLL_EDGE = 72;
/** Fastest the page scrolls itself during a drag, in pixels per frame. */
const AUTOSCROLL_MAX = 16;

class DragHandleView {
  private handle: HTMLElement;
  private addBtn: HTMLElement;
  private indicator: HTMLElement;
  private menu: HTMLElement | null = null;
  private hovered: Block | null = null;
  private dragging: Block | null = null;
  private dropInsertPos: number | null = null;
  // The dragged block's siblings, snapshotted when the drag starts: the drop target is
  // always one of these, so there is no reason to re-derive them on every move.
  private dragSiblings: Sibling[] = [];
  private scroller: HTMLElement | null = null;
  private autoScrollDir = 0;
  private autoScrollFrame = 0;
  // Touch only: the block the caret is in, which is the one the floating grip acts on.
  private activeTouchBlock: Block | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Hover bookkeeping. `pendingPoint` + `frame` collapse a burst of mousemoves into one
  // measurement per animation frame — the handle only needs to be right once per frame,
  // and the lookup behind it can walk the whole document.
  private pendingPoint: { x: number; y: number } | null = null;
  private frame = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private view: EditorView) {
    views.set(view, this);

    this.handle = document.createElement("div");
    this.handle.className = "lockpad-drag-handle";
    this.handle.setAttribute("contenteditable", "false");
    // A real control, not a decorated div: it can be tabbed to, it says what it is, and
    // it says that pressing it opens something. Reordering used to be mouse-only.
    this.handle.setAttribute("role", "button");
    this.handle.setAttribute("tabindex", "0");
    this.handle.setAttribute("aria-haspopup", "menu");
    this.handle.setAttribute("aria-label", "Move block");
    this.handle.title = "Drag to reorder · click for options";
    // Track A: the browser owns the desktop drag. A native drag suppresses text
    // selection by construction (the selection the mouse would otherwise paint never
    // starts), carries a real drag image of the block, and cannot be stolen mid-gesture
    // the way a hand-rolled pointer drag can.
    this.handle.draggable = true;
    this.handle.innerHTML = `<span class="lockpad-drag-handle-grip">${GRIP}</span>`;
    this.handle.style.display = "none";
    document.body.appendChild(this.handle);

    // Contextual "+" insert affordance (PRD 7). A sibling of the drag grip (a
    // separate element so a "+" click never starts a drag): shown in the left
    // gutter on block hover, it inserts an empty block after the hovered one and
    // opens the same command menu the "/" shortcut does — an additive entry point,
    // not a competing one.
    this.addBtn = document.createElement("div");
    this.addBtn.className = "lockpad-add-block";
    this.addBtn.setAttribute("contenteditable", "false");
    this.addBtn.setAttribute("role", "button");
    this.addBtn.setAttribute("tabindex", "0");
    this.addBtn.setAttribute("aria-label", "Insert block below");
    this.addBtn.title = "Insert block";
    this.addBtn.innerHTML = `<span class="lockpad-add-block-icon">${PLUS}</span>`;
    this.addBtn.style.display = "none";
    document.body.appendChild(this.addBtn);

    this.indicator = document.createElement("div");
    this.indicator.className = "lockpad-drop-indicator";
    this.indicator.style.display = "none";
    document.body.appendChild(this.indicator);

    view.dom.addEventListener("mousemove", this.onEditorMouseMove);
    view.dom.addEventListener("mouseleave", this.onEditorMouseLeave);
    // The gutter is outside the editor's own box, so without this the handle would be
    // hidden by the very act of reaching for it.
    view.dom.parentElement?.addEventListener("mousemove", this.onGutterMouseMove);
    this.handle.addEventListener("mouseenter", this.cancelHide);
    this.handle.addEventListener("dragstart", this.onDragStart);
    this.handle.addEventListener("dragend", this.onDragEnd);
    // The menu opens on mouse-UP, not on click. A `draggable` element does not
    // reliably produce a click: the few pixels of travel in an ordinary press are
    // enough for the browser to call it a drag instead, and the click event is then
    // never delivered. But a mouseup on the element only ever arrives when NO drag
    // started (a real drag ends in dragend), so it is the honest signal for "pressed
    // this and let go without dragging it".
    this.handle.addEventListener("mousedown", this.onHandleMouseDown);
    this.handle.addEventListener("mouseup", this.onHandleMouseUp);
    this.handle.addEventListener("keydown", this.onHandleKeyDown);
    // Touch: the grip runs its own pointer drag, because HTML5 drag-and-drop does not
    // exist on touch devices. It can do so safely where the old long-press could not —
    // the grip is outside the editable DOM and carries a static `touch-action: none`,
    // so the browser never claims the gesture as a scroll and never starts a selection.
    this.handle.addEventListener("pointerdown", this.onHandlePointerDown);
    this.addBtn.addEventListener("mouseenter", this.cancelHide);
    this.addBtn.addEventListener("mousedown", (e) => e.preventDefault());
    this.addBtn.addEventListener("click", this.onAddClick);
    window.addEventListener("scroll", this.onViewportChange, true);
    window.addEventListener("resize", this.onViewportChange);
    // The touch grip is pinned to a block's coordinates, and a phone reflows under it
    // constantly: the keyboard opens, a picture finishes loading, the sheet finishes
    // animating in. None of those are a scroll, a selection change, or an edit, so
    // nothing else here would notice — and the grip would be left floating beside
    // whatever now occupies the place its block used to be.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.activeTouchBlock && !this.dragging) this.showTouchHandle(this.activeTouchBlock);
    });
    this.resizeObserver.observe(view.dom);
  }

  // ── Desktop hover ────────────────────────────────────────────────────────────
  //
  // Skipped entirely on a touch device. A phone fires a synthetic mousemove after a
  // tap, so without this guard tapping a paragraph summons the DESKTOP gutter cluster
  // — 52px of grip and "+" laid out to the left of a text column that starts 20px
  // from the screen edge, i.e. half of it drawn off-screen. That is the clipped handle
  // that made this feature feel broken on a phone. Touch has its own grip; the two
  // never both apply.
  private onEditorMouseMove = (e: MouseEvent) => {
    if (this.dragging || !this.view.editable || isCoarsePointer()) return;
    this.queueHandleAt(e.clientX, e.clientY);
  };

  // Moving through the gutter toward the grip: keep the cluster where it is rather
  // than treating the trip as leaving the editor.
  private onGutterMouseMove = (e: MouseEvent) => {
    if (this.dragging || !this.view.editable || !this.hovered || isCoarsePointer()) return;
    const rect = this.view.dom.getBoundingClientRect();
    const inBand = e.clientX < rect.left && e.clientX > rect.left - 80 &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (inBand) this.cancelHide();
  };

  private onEditorMouseLeave = () => {
    if (this.dragging) return;
    this.hideTimer = setTimeout(() => this.hideHandle(), 350);
  };
  private cancelHide = () => {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  };

  // One measurement per frame, however many mousemoves the browser delivers.
  private queueHandleAt(x: number, y: number) {
    this.pendingPoint = { x, y };
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const p = this.pendingPoint;
      this.pendingPoint = null;
      if (p) this.showHandleAt(p.x, p.y);
    });
  }

  private onViewportChange = () => {
    // A scroll or resize moves the block out from under a handle pinned to the
    // viewport. Hide rather than chase it: the next mousemove will place it correctly.
    if (this.dragging) return;
    this.closeMenu();
    if (this.activeTouchBlock) { this.showTouchHandle(this.activeTouchBlock); return; }
    this.hideHandle();
  };

  // Position the handle + "+" cluster in the left gutter. Two invariants that make it
  // read the SAME for every block type (paragraph, bullet/numbered/checklist item…):
  //   • Horizontal: one shared gutter x — the editor's content-left, where top-level
  //     text begins — NOT each block's own left. Otherwise indented list items push
  //     the cluster right of where it sits for paragraphs, which looked inconsistent.
  //   • Vertical: centred on the block's FIRST LINE, not its full height. On a multi-
  //     line block the cluster then sits beside the first line (like Notion) instead
  //     of floating at mid-height.
  private positionHandle(rect: DOMRect, dom: HTMLElement) {
    const w = 24; // keep in sync with .lockpad-drag-handle width in index.css
    const addW = 24; // keep in sync with .lockpad-add-block width in index.css
    const handleH = 32; // keep in sync with .lockpad-drag-handle height in index.css
    const gap = 4; // clear gutter gap so the cluster sits beside — not over — the text

    // Shared left reference: the editor content-left (min with the block's own left so
    // we never end up to the right of the block itself).
    const ed = this.view.dom as HTMLElement;
    const edStyle = getComputedStyle(ed);
    const contentLeft = ed.getBoundingClientRect().left + (parseFloat(edStyle.paddingLeft) || 0);
    const refLeft = Math.min(rect.left, contentLeft);

    const top = `${Math.round(firstLineCentre(rect, dom) - handleH / 2)}px`;

    // Grip sits closest to the block; the "+" sits just left of the grip. Both are
    // clamped to stay on screen: a narrow window (or a note whose gutter has been
    // squeezed) would otherwise push the cluster past the left edge, where it is
    // half-drawn and impossible to grab.
    const addLeft = Math.max(2, Math.round(refLeft - gap - w - addW));
    this.handle.style.left = `${addLeft + addW}px`;
    this.handle.style.top = top;
    this.addBtn.style.left = `${addLeft}px`;
    this.addBtn.style.top = top;
  }

  private showHandleAt(clientX: number, clientY: number) {
    const block = blockAtPoint(this.view, clientX, clientY);
    if (!block) { return; }
    const dom = this.view.nodeDOM(block.pos);
    if (!(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    this.hovered = block;
    this.cancelHide();
    this.handle.classList.remove("is-touch");
    this.handle.style.display = "flex";
    this.addBtn.style.display = "flex";
    this.positionHandle(rect, dom);
  }

  // ── Track B: touch ───────────────────────────────────────────────────────────
  //
  // Touch gets the same grip, put where a finger can reach it and revealed by the
  // thing a finger does anyway — tapping into a block. What it replaces is a
  // long-press on the text itself, which was a race against the platform's own
  // ~500ms press-to-select and one we regularly lost: the note would start
  // selecting words instead of picking the block up. Nothing here competes with the
  // browser, so there is nothing to lose.
  //
  // It rides the block's trailing edge rather than the leading one: the left gutter
  // is 20px on a phone against the ~52px this cluster needs, while the right margin
  // is the same 20px next to the ragged end of a line, which is usually empty.
  private showTouchHandle(block: Block) {
    const dom = this.view.nodeDOM(block.pos);
    if (!(dom instanceof HTMLElement)) { this.hideHandle(); return; }
    const rect = dom.getBoundingClientRect();
    const size = 34; // keep in sync with .lockpad-drag-handle.is-touch in index.css
    this.activeTouchBlock = block;
    this.hovered = block;
    this.handle.classList.add("is-touch");
    this.handle.style.display = "flex";
    this.handle.style.left = `${Math.round(Math.min(window.innerWidth - size - 2, rect.right - 6))}px`;
    this.handle.style.top = `${Math.round(firstLineCentre(rect, dom) - size / 2)}px`;
    this.addBtn.style.display = "none"; // the gutter "+" has no room on a phone
  }

  private hideHandle() {
    if (this.dragging) return;
    this.closeMenu();
    this.handle.style.display = "none";
    this.addBtn.style.display = "none";
    this.hovered = null;
    this.activeTouchBlock = null;
  }

  // Insert an empty block after the hovered one and open the command menu there
  // (by inserting the "/" trigger), so "+" is a pointer-driven equivalent of "/".
  private onAddClick = (e: MouseEvent) => {
    e.preventDefault();
    const block = this.hovered;
    if (!block || !this.view.editable) return;
    const { state } = this.view;
    const insertPos = block.pos + block.node.nodeSize;
    const paragraph = state.schema.nodes.paragraph.createAndFill();
    if (!paragraph) return;
    let tr = state.tr.insert(insertPos, paragraph);
    // Place the cursor inside the new (empty) paragraph: insertPos is just before
    // the node, +1 enters it.
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
    // Open the slash menu at the new line (Suggestion listens for "/").
    this.view.dispatch(this.view.state.tr.insertText("/"));
    this.hideHandle();
  };

  // ── The handle's menu: reordering without a gesture ──────────────────────────
  private pressStart: { x: number; y: number; at: number } | null = null;

  private onHandleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.pressStart = { x: e.clientX, y: e.clientY, at: e.timeStamp };
  };

  private onHandleMouseUp = (e: MouseEvent) => {
    const start = this.pressStart;
    this.pressStart = null;
    if (!start || this.dragging) return;
    // A press that neither travelled nor lingered: the user meant to press a button.
    const moved = Math.abs(e.clientX - start.x) > 6 || Math.abs(e.clientY - start.y) > 6;
    if (moved || e.timeStamp - start.at > 600) return;
    e.preventDefault();
    this.toggleMenu();
  };

  private onHandleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.toggleMenu(); return; }
    // The same shortcut the editor uses, so the muscle memory carries over to the
    // handle once you have tabbed to it.
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      this.moveHovered(e.key === "ArrowUp" ? -1 : 1);
    }
  };

  private moveHovered(direction: -1 | 1) {
    const block = this.hovered;
    if (!block || !this.view.editable) return;
    const sibs = siblingsOf(this.view, block);
    const index = sibs.findIndex((s) => s.pos === block.pos);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sibs.length) {
      announce(direction < 0 ? "Already the first block" : "Already the last block");
      return;
    }
    const insertPos = direction < 0 ? sibs[target].pos : sibs[target].pos + sibs[target].size;
    if (performBlockMove(this.view, block, insertPos, false)) {
      announce(direction < 0 ? "Block moved up" : "Block moved down");
    }
    this.closeMenu();
    this.hideHandle();
  }

  private toggleMenu() {
    if (this.menu) { this.closeMenu(); return; }
    if (!this.hovered) return;
    const menu = document.createElement("div");
    menu.className = "lockpad-block-menu";
    menu.setAttribute("role", "menu");
    for (const [label, dir] of [["Move up", -1], ["Move down", 1]] as const) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.className = "lockpad-block-menu-item";
      item.textContent = label;
      item.addEventListener("click", (e) => { e.preventDefault(); this.moveHovered(dir); });
      menu.appendChild(item);
    }
    document.body.appendChild(menu);
    this.menu = menu;
    const h = this.handle.getBoundingClientRect();
    // Below the grip by default, above it when there is no room underneath.
    const mh = menu.getBoundingClientRect().height;
    const below = h.bottom + 6 + mh < window.innerHeight;
    const top = below ? h.bottom + 6 : h.top - 6 - mh;
    menu.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, h.left)))}px`;
    // Clamped into the viewport on both axes: near the bottom of a note the grip can
    // sit low enough that even the "above" placement runs off the screen edge.
    menu.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - mh - 8, top)))}px`;
    (menu.firstElementChild as HTMLElement | null)?.focus();
    document.addEventListener("pointerdown", this.onDocPointerDown, true);
    document.addEventListener("keydown", this.onMenuKeyDown, true);
  }

  private closeMenu() {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    document.removeEventListener("pointerdown", this.onDocPointerDown, true);
    document.removeEventListener("keydown", this.onMenuKeyDown, true);
  }

  private onDocPointerDown = (e: PointerEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node) && e.target !== this.handle) this.closeMenu();
  };
  private onMenuKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); this.closeMenu(); this.handle.focus(); }
  };

  // ── Track A: the desktop drag, run by the browser ────────────────────────────
  private onDragStart = (event: DragEvent) => {
    const block = this.hovered;
    if (!block || !this.view.editable || !event.dataTransfer) { event.preventDefault(); return; }
    this.closeMenu();
    this.beginDrag(block);
    event.dataTransfer.effectAllowed = "move";
    // Our own MIME type, and nothing the outside world understands: this drag is a
    // reorder inside one note, not an export. Dropping it on another app or another
    // pane should do nothing rather than paste a stray copy of the block.
    event.dataTransfer.setData("application/x-lockpad-block", String(block.pos));
    const dom = this.view.nodeDOM(block.pos);
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      // Drag the block itself, grabbed near its leading edge, so what follows the
      // cursor is the thing being moved rather than a picture of a grip.
      event.dataTransfer.setDragImage(dom, Math.min(40, rect.width / 2), Math.min(20, rect.height / 2));
    }
  };

  /** Plugin prop: called for every dragover inside the editor. */
  onDragOver(event: DragEvent): boolean {
    if (!this.dragging) return false;
    event.preventDefault(); // without this the browser refuses the drop
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    this.updateDrop(event.clientY);
    this.updateAutoScroll(event.clientY);
    return true;
  }

  /** Plugin prop: the drop itself. Returning true keeps ProseMirror's own drop
   *  handling out of it — this is a reorder we already know how to perform, not
   *  content to be parsed and pasted. */
  onDrop(event: DragEvent): boolean {
    if (!this.dragging) return false;
    event.preventDefault();
    const source = this.dragging;
    const insertPos = this.dropInsertPos;
    this.teardownDrag();
    if (insertPos != null) performBlockMove(this.view, source, insertPos, false);
    return true;
  }

  private onDragEnd = () => {
    // Fires whether the drop landed or the drag was abandoned, so cleanup lives here
    // rather than being duplicated across every way a drag can end.
    this.teardownDrag();
  };

  // ── Touch drag: the same drop logic, driven by pointer events ────────────────
  private onHandlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !this.hovered || !this.view.editable) return;
    // The grip is not editable content and its touch-action is none, so this is safe
    // to claim outright: no scroll to lose it to, no selection to fight.
    event.preventDefault();
    const block = this.hovered;
    const startY = event.clientY;
    let moved = false;
    const onMove = (move: PointerEvent) => {
      if (!moved && Math.abs(move.clientY - startY) < 6) return;
      if (!moved) { moved = true; this.beginDrag(block); navigator.vibrate?.(10); }
      move.preventDefault();
      this.updateDrop(move.clientY);
      this.updateAutoScroll(move.clientY);
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (!moved) { this.toggleMenu(); return; } // a tap, not a drag
      const insertPos = this.dropInsertPos;
      this.teardownDrag();
      if (insertPos != null) performBlockMove(this.view, block, insertPos, false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  private beginDrag(block: Block) {
    this.dragging = block;
    this.dropInsertPos = null;
    this.dragSiblings = siblingsOf(this.view, block);
    this.scroller = scrollableAncestor(this.view.dom);
    this.addBtn.style.display = "none"; // no insert affordance mid-drag
    document.body.classList.add("lockpad-dragging");
    const dom = this.view.nodeDOM(block.pos);
    if (dom instanceof HTMLElement) dom.classList.add("lockpad-drag-source");
    window.addEventListener("keydown", this.onDragKeyDown);
  }

  // The drop target: the sibling boundary nearest the pointer.
  //
  // It resolves to the NEAREST one rather than requiring the pointer to be over a
  // sibling, which is what it used to do. Hovering a gap between blocks, a nested
  // list, or the empty space beside a short line all used to return nothing: the drop
  // line blinked out and releasing there did nothing at all, which reads as a broken
  // feature rather than as an invalid target. There is always somewhere to land.
  private updateDrop(y: number) {
    if (!this.dragging || this.dragSiblings.length === 0) return;
    let best: { insertPos: number; edge: number; rect: DOMRect } | null = null;
    for (const sib of this.dragSiblings) {
      const rect = domRect(this.view, sib.pos);
      if (!rect) continue;
      const candidates: Array<[number, number]> = [
        [rect.top, sib.pos],                 // land before this sibling
        [rect.bottom, sib.pos + sib.size],   // land after it
      ];
      for (const [edge, insertPos] of candidates) {
        if (!best || Math.abs(edge - y) < Math.abs(best.edge - y)) best = { insertPos, edge, rect };
      }
    }
    if (!best) return;
    this.dropInsertPos = best.insertPos;
    this.indicator.style.display = "block";
    this.indicator.style.left = `${Math.round(best.rect.left)}px`;
    this.indicator.style.top = `${Math.round(best.edge)}px`;
    this.indicator.style.width = `${Math.round(best.rect.width)}px`;
  }

  // Dragging toward the edge of the note scrolls it, so a block can be moved further
  // than one screenful. The note body is its own scroller (the mobile sheet, the
  // desktop panel), so this deliberately scrolls THAT and not the window.
  private updateAutoScroll(y: number) {
    const box = this.scroller;
    if (!box) return;
    const rect = box === document.scrollingElement
      ? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
      : box.getBoundingClientRect();
    let dir = 0;
    if (y - rect.top < AUTOSCROLL_EDGE) dir = -(1 - (y - rect.top) / AUTOSCROLL_EDGE);
    else if (rect.bottom - y < AUTOSCROLL_EDGE) dir = 1 - (rect.bottom - y) / AUTOSCROLL_EDGE;
    this.autoScrollDir = Math.max(-1, Math.min(1, dir));
    if (this.autoScrollDir === 0) { this.stopAutoScroll(); return; }
    if (this.autoScrollFrame) return;
    const step = () => {
      if (!this.dragging || this.autoScrollDir === 0) { this.autoScrollFrame = 0; return; }
      box.scrollTop += this.autoScrollDir * AUTOSCROLL_MAX;
      this.autoScrollFrame = requestAnimationFrame(step);
    };
    this.autoScrollFrame = requestAnimationFrame(step);
  }

  private stopAutoScroll() {
    this.autoScrollDir = 0;
    if (this.autoScrollFrame) { cancelAnimationFrame(this.autoScrollFrame); this.autoScrollFrame = 0; }
  }

  private onDragKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") this.teardownDrag(); };

  private teardownDrag() {
    if (!this.dragging) return;
    const dom = this.view.nodeDOM(this.dragging.pos);
    if (dom instanceof HTMLElement) dom.classList.remove("lockpad-drag-source");
    this.dragging = null;
    this.dropInsertPos = null;
    this.dragSiblings = [];
    this.stopAutoScroll();
    this.indicator.style.display = "none";
    document.body.classList.remove("lockpad-dragging");
    window.removeEventListener("keydown", this.onDragKeyDown);
    this.hideHandle();
  }

  update(_view: EditorView, prevState?: EditorState) {
    if (this.dragging) return;
    if (!this.view.editable) { this.hideHandle(); return; }
    // Touch: the grip follows the caret, because tapping into a block is what a finger
    // does anyway — no extra gesture to learn, and nothing for the browser to claim.
    if (!isCoarsePointer()) return;
    const sel = this.view.state.selection;
    if (prevState && prevState.selection.eq(sel) && prevState.doc.eq(this.view.state.doc)) return;
    const block = blockAt(this.view, sel.from);
    if (block) this.showTouchHandle(block);
    else this.hideHandle();
  }

  destroy() {
    this.teardownDrag();
    this.closeMenu();
    views.delete(this.view);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.view.dom.removeEventListener("mousemove", this.onEditorMouseMove);
    this.view.dom.removeEventListener("mouseleave", this.onEditorMouseLeave);
    this.view.dom.parentElement?.removeEventListener("mousemove", this.onGutterMouseMove);
    window.removeEventListener("scroll", this.onViewportChange, true);
    window.removeEventListener("resize", this.onViewportChange);
    this.handle.remove();
    this.addBtn.remove();
    this.indicator.remove();
  }
}

/** Vertical centre of a block's first line — where the grip sits beside it. */
function firstLineCentre(rect: DOMRect, dom: HTMLElement): number {
  const cs = getComputedStyle(dom);
  const padTop = parseFloat(cs.paddingTop) || 0;
  let lineH = parseFloat(cs.lineHeight);
  if (!Number.isFinite(lineH)) lineH = (parseFloat(cs.fontSize) || 16) * 1.5;
  return rect.top + padTop + Math.min(lineH, rect.height) / 2;
}

/** The nearest ancestor that actually scrolls — the note body, not the window. */
function scrollableAncestor(el: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.body;
}

function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
}
