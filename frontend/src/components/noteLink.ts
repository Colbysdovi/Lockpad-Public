import { Node, mergeAttributes } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { NoteLinkView } from "./NoteLinkView";
import { tOutsideReact } from "@/lib/i18n";

// The inline note-link chip (note-link-chip-prd.md).
//
// Picking a note from the [[ picker used to leave the two typed brackets sitting in
// the prose and record the relationship somewhere else entirely — the sentence read
// as if it had broken off mid-thought, and the link itself was only discoverable by
// looking at the Links row. This node is what goes in the brackets' place: a real
// reference, inside the sentence, that you can click.
//
// INLINE and ATOM, deliberately. Inline because a reference belongs in the middle of
// a sentence, not on a line of its own like the smart-link CARD (which is the same
// pattern one level up — see smartLink.ts, which this deliberately mirrors). Atom
// because it is one indivisible thing: you select it whole, you delete it whole, and
// there is nothing inside it to put a caret in. That also means backspace removes it
// in a single press, which is what makes "delete the chip" an ordinary text edit
// rather than a special gesture needing its own affordance.
//
// ── What is stored, and what is resolved ────────────────────────────────────────
//
// Attrs carry `noteId` (the reference itself) and `title` (a snapshot, only ever a
// FALLBACK). The live chip does not trust the snapshot: NoteLinkView reads today's
// title out of the note's own link list, so renaming a note updates every chip that
// points at it. The snapshot exists for the surfaces that have no data layer to ask
// — the list-card miniature, clipboard HTML, an exported file — where a slightly
// stale title is still worth infinitely more than a blank chip or a raw id.

// lucide "file-text" — a PAGE, deliberately not the chain used by external links.
// The two must never be confused at a glance (PRD §3.1), and shape carries that
// difference where colour alone would not.
const NOTE_ICON: DOMOutputSpec = [
  "svg",
  { viewBox: "0 0 24 24", width: "14", height: "14", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }],
  ["path", { d: "M10 9H8" }],
  ["path", { d: "M16 13H8" }],
  ["path", { d: "M16 17H8" }],
];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteLink: {
      /** Replace `range` (the typed trigger) with a chip pointing at `noteId`. */
      insertNoteLink: (attrs: { noteId: string; title: string }, range?: { from: number; to: number }) => ReturnType;
    };
  }
}

export const NoteLink = Node.create({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  // Not draggable: the app's gutter drag-handle moves BLOCKS, and an inline atom that
  // could be dragged out of its sentence would just be a way to scramble prose.
  draggable: false,

  addAttributes() {
    return {
      noteId: { default: "" },
      // Snapshot only. See the note at the top of the file — never read this in the
      // live editor when the real title can be resolved.
      title: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-note-link]",
        getAttrs: (el) => ({
          noteId: (el as HTMLElement).getAttribute("data-note-id") || "",
          title: (el as HTMLElement).getAttribute("data-title") || (el as HTMLElement).textContent?.trim() || "",
        }),
      },
    ];
  },

  // Static chip — clipboard HTML, the note-list card preview, and any HTML round-trip.
  // Same classes as the live NodeView so one set of CSS rules dresses both, and the
  // miniature on a card looks like the thing it is a miniature OF.
  renderHTML({ HTMLAttributes }) {
    const noteId = String(HTMLAttributes.noteId ?? "");
    const title = String(HTMLAttributes.title ?? "").trim() || tOutsideReact("note.untitled");
    return [
      "a",
      mergeAttributes({
        "data-note-link": "",
        "data-note-id": noteId,
        "data-title": title,
        class: "note-link-chip note-link-static",
      }),
      ["span", { class: "note-link-icon", "aria-hidden": "true" }, NOTE_ICON],
      ["span", { class: "note-link-title" }, title],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkView);
  },

  addCommands() {
    return {
      insertNoteLink:
        (attrs, range) =>
        ({ chain }) => {
          const c = chain().focus();
          // Deleting the trigger and inserting the chip in ONE chain is what makes
          // both a single undo step: pressing undo once after linking puts the two
          // brackets back, rather than leaving the chip's corpse behind.
          if (range) c.deleteRange(range);
          return c.insertContent({ type: "noteLink", attrs }).run();
        },
    };
  },
});
