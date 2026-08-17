import { useMemo } from "react";
import { generateHTML } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import DOMPurify from "dompurify";
import { SmartLink } from "./smartLink";
import { NoteLink } from "./noteLink";
import { Highlight } from "./highlight";
import { NoteImage } from "./imageNode";
import { cn } from "@/lib/utils";

// The card preview renders the note's own content through the SAME extensions and
// the SAME `.ProseMirror` styling as the detail editor, so a card is a faithful
// (just bounded + non-interactive) miniature of the note — headings keep their
// serif face and level, marks/lists/quotes/code all match. The doc is already
// truncated server-side (`previewDoc`); here we only turn JSON → sanitized HTML.
//
// Extensions mirror Editor.tsx. Editing-only plugins (SlashCommand, drag handle,
// placeholder) are irrelevant to static rendering and omitted.
//
// Code blocks keep StarterKit's plain node here rather than the editor's
// CodeBlockLowlight: lowlight paints its token colours with ProseMirror
// DECORATIONS, which only exist inside a live editor view — registering it would
// add the whole highlight.js grammar set to the list bundle and still render the
// same uncoloured markup. The card keeps the dark code surface (see
// `.note-preview pre`), just without the syntax colours.
const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Link.configure({ openOnClick: false, autolink: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  // Registering SmartLink is what lets a note containing a smart link preview at all:
  // without it, generateHTML throws on the unknown node and the whole preview blanks.
  // Its static renderHTML (a card, not a NodeView) is what shows in the miniature.
  SmartLink,
  // Same reason: an unregistered mark makes generateHTML throw, which would blank
  // the ENTIRE card for any note containing a single highlighted word.
  Highlight,
  // Ditto for a note with a picture in it. The static renderHTML is what shows here
  // (React node views only apply inside a live editor), so the card gets a real,
  // size-capped thumbnail rather than a gap.
  NoteImage,
  // And an inline note-link chip. Same rule as the three above — an unregistered node
  // makes generateHTML throw and blanks the whole card — but with a twist worth
  // knowing: the chip's static renderHTML shows the title SNAPSHOT stored in the node,
  // because a card preview has no note to resolve against. It can therefore lag a
  // rename until the note is next opened, where the live chip corrects itself.
  NoteLink,
];

export function NotePreview({ doc, className }: { doc: unknown; className?: string }) {
  const html = useMemo(() => {
    if (!doc || typeof doc !== "object") return "";
    try {
      return DOMPurify.sanitize(generateHTML(doc as JSONContent, extensions));
    } catch {
      return "";
    }
  }, [doc]);

  if (!html) return null;
  return (
    <div
      className={cn("ProseMirror note-preview", className)}
      aria-hidden
      // Our own stored note JSON, rendered to HTML then sanitized — safe to inject.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
