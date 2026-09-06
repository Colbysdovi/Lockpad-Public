// Every table operation, in one place.
//
// They are reached from two entry points now — the toolbar's table button
// (Editor.tsx) and the per-cell handle that appears at the selected cell
// (tableCellHandle.ts) — and one of those is React while the other is plain DOM
// inside a ProseMirror plugin. Two entry points transcribing the same list is
// exactly how they drift: an action added to one menu and forgotten in the other,
// or a fix applied once. So the list lives here and both read it.
//
// Order matters, and so does `group`: add, then rearrange, then take away. Both menus
// draw a divider wherever the group changes rather than at a fixed index, so inserting
// an action in the middle of this list cannot leave a divider in the wrong place.
import type { Editor } from "@tiptap/core";
import { moveTableRow, moveTableColumn } from "@tiptap/pm/tables";
import { currentTableSize, currentTablePosition } from "@/components/tableNode";
import type { MessageKey } from "@/lib/i18n";

export interface TableAction {
  /** Catalogue key — resolved where the menu is drawn, never stored translated. */
  key: MessageKey;
  /** A divider is drawn wherever this changes between two neighbours. */
  group: "add" | "move" | "remove";
  /** Takes something away: shown in the destructive style. */
  danger?: boolean;
  /** Whether the action can do anything right now. A move at the edge of the table
   *  cannot, and an action that silently does nothing when pressed is a dead end —
   *  the menu greys it out instead, so the edge is visible before the click. Absent
   *  means always available. */
  enabled?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

/** Run a raw prosemirror-tables command. They are ProseMirror commands rather than
 *  TipTap ones — this feature's four moves have no TipTap equivalent — so they are
 *  handed the chain's own state and dispatch. */
function pm(editor: Editor, command: (state: never, dispatch: never) => boolean): void {
  editor
    .chain()
    .focus()
    .command(({ state, dispatch }) => command(state as never, dispatch as never))
    .run();
}

/** Move the row holding the caret by one, in either direction.
 *
 *  A leading header row is a floor, not just an edge: moving a data row above it would
 *  leave the tinted heading in the middle of the data, describing nothing. `enabled`
 *  below keeps the caller from asking, and this keeps it from happening if they do. */
function moveRow(editor: Editor, delta: -1 | 1): void {
  const at = currentTablePosition(editor);
  if (!at) return;
  const to = at.row + delta;
  if (to < at.headerRows || to > at.rows - 1 || at.row < at.headerRows) return;
  pm(editor, moveTableRow({ from: at.row, to }) as never);
}

function moveColumn(editor: Editor, delta: -1 | 1): void {
  const at = currentTablePosition(editor);
  if (!at) return;
  const to = at.col + delta;
  if (to < 0 || to > at.cols - 1) return;
  pm(editor, moveTableColumn({ from: at.col, to }) as never);
}

export const TABLE_ACTIONS: TableAction[] = [
  { key: "editor.table.insertRowAbove", group: "add", run: (e) => e.chain().focus().addRowBefore().run() },
  { key: "editor.table.insertRowBelow", group: "add", run: (e) => e.chain().focus().addRowAfter().run() },
  { key: "editor.table.insertColumnLeft", group: "add", run: (e) => e.chain().focus().addColumnBefore().run() },
  { key: "editor.table.insertColumnRight", group: "add", run: (e) => e.chain().focus().addColumnAfter().run() },
  // Reordering. Each one is greyed out at the edge it cannot cross — the top of the
  // data for a row (the header row is not data and does not move), and either end of
  // the table for a column.
  {
    key: "editor.table.moveRowUp",
    group: "move",
    enabled: (e) => { const at = currentTablePosition(e); return !!at && at.row > at.headerRows; },
    run: (e) => moveRow(e, -1),
  },
  {
    key: "editor.table.moveRowDown",
    group: "move",
    enabled: (e) => { const at = currentTablePosition(e); return !!at && at.row >= at.headerRows && at.row < at.rows - 1; },
    run: (e) => moveRow(e, 1),
  },
  {
    key: "editor.table.moveColumnLeft",
    group: "move",
    enabled: (e) => { const at = currentTablePosition(e); return !!at && at.col > 0; },
    run: (e) => moveColumn(e, -1),
  },
  {
    key: "editor.table.moveColumnRight",
    group: "move",
    enabled: (e) => { const at = currentTablePosition(e); return !!at && at.col < at.cols - 1; },
    run: (e) => moveColumn(e, 1),
  },
  // Deleting the LAST row (or the last column) removes the whole table.
  //
  // Left alone, prosemirror-tables refuses: it will not leave a table with no rows,
  // so the command simply does nothing — verified, not assumed. Nothing breaks, but
  // the user is in a dead end. They asked for the last row to go, the app went
  // silent, and there is no way out of a one-row table except selecting it by hand.
  //
  // Removing the table is the more useful of the two answers the PRD allows, and it
  // is the one that leaves nothing behind that cannot be undone with ⌘Z.
  {
    key: "editor.table.deleteRow",
    group: "remove",
    danger: true,
    run: (e) => {
      const size = currentTableSize(e);
      if (size && size.rows <= 1) e.chain().focus().deleteTable().run();
      else e.chain().focus().deleteRow().run();
    },
  },
  {
    key: "editor.table.deleteColumn",
    group: "remove",
    danger: true,
    run: (e) => {
      const size = currentTableSize(e);
      if (size && size.cols <= 1) e.chain().focus().deleteTable().run();
      else e.chain().focus().deleteColumn().run();
    },
  },
  // And a direct way out, so removing a five-by-five table is not five deletions.
  { key: "editor.table.deleteTable", group: "remove", danger: true, run: (e) => e.chain().focus().deleteTable().run() },
];
