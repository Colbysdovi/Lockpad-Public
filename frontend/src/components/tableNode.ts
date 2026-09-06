// The table node, wrapped in something that can scroll.
//
// A table is the only block in a note that can be WIDER than the note itself: add
// enough columns and it has to go somewhere. It must not push the note panel
// sideways — nothing else in the app scrolls horizontally — so the table carries its
// own scrolling box and the panel never learns about it.
//
// TipTap builds that box itself, but only when column resizing is switched on, and
// resizing is a separate decision from scrolling. So the wrapper is added here
// instead, using TipTap's own class name (`tableWrapper`) rather than a new one:
// if resizing is ever enabled, TipTap's node view produces the same structure with
// the same class, and the stylesheet keeps working unchanged instead of silently
// styling a wrapper that is no longer there.
//
// Shared with the note-card preview renderer so a table looks the same shape in a
// card as it does in the editor.
import Table from "@tiptap/extension-table";
import { mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

export const TableWithScroll = Table.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { class: "tableWrapper" },
      // The `0` is ProseMirror's content hole: rows are children of the tbody, so
      // the wrapper stays outside the editable content and the caret cannot land in it.
      ["table", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), ["tbody", 0]],
    ];
  },
});

/** How many rows and columns the table containing the caret has, or null if the
 *  caret is not in a table. Column count is read off the first row, which is exact
 *  here because merged cells are out of scope for this feature. */
export function currentTableSize(editor: Editor): { rows: number; cols: number } | null {
  const $from = editor.state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") {
      return { rows: node.childCount, cols: node.firstChild?.childCount ?? 0 };
    }
  }
  return null;
}

/** Where the caret sits in its table, and what room there is around it — enough to
 *  answer "can this row move up?" without asking prosemirror-tables twice.
 *
 *  `headerRows` is how many leading rows are made of header cells (0 or 1 for every
 *  table this app creates). It is what stops a data row being moved above the header,
 *  which would leave the tinted heading stranded in the middle of the data.
 *
 *  Indices come from the resolved position rather than from a TableMap, which is exact
 *  as long as no cell spans two columns or two rows. Nothing in this app can create a
 *  merged cell — there is no merge action — so the only way to meet one is to paste a
 *  table from elsewhere, and then these indices count cells rather than grid columns. */
export interface TablePosition {
  row: number;
  col: number;
  rows: number;
  cols: number;
  headerRows: number;
}

export function currentTablePosition(editor: Editor): TablePosition | null {
  const $from = editor.state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const table = $from.node(depth);
    if (table.type.name !== "table") continue;
    const firstRow = table.firstChild;
    let headerRows = 0;
    if (firstRow) {
      let allHeader = firstRow.childCount > 0;
      firstRow.forEach((cell) => { if (cell.type.name !== "tableHeader") allHeader = false; });
      headerRows = allHeader ? 1 : 0;
    }
    return {
      // index(d) is the position of the child of the node at depth d, so the table's
      // depth gives the row and one deeper gives the cell within that row.
      row: $from.index(depth),
      col: $from.index(depth + 1),
      rows: table.childCount,
      cols: firstRow?.childCount ?? 0,
      headerRows,
    };
  }
  return null;
}
