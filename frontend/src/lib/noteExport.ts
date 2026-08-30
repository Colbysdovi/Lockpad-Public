// Single-note export orchestration (Markdown now; PDF wired in the print view).
// Everything runs client-side against the note's already-loaded TipTap content —
// no server round-trip, nothing uploaded.
import type { Note } from "./types";
import { tiptapToMarkdown } from "./tiptapMarkdown";
import { inlineNoteImages } from "./noteImages";
import { downloadText, sanitizeFilename } from "./download";
import { printNote } from "@/components/NotePrintHost";
import { tOutsideReact } from "@/lib/i18n";

/** Export an unlocked note's content to a `.md` file, led by its title as an H1.
 *  Callers must gate on `!note.isLocked` — a locked note has no plaintext content
 *  here (it's null), so there is nothing to serialize.
 *
 *  Asynchronous because of the pictures: any image in the note is pulled in as a
 *  data URI first, so the file that lands in the Downloads folder is COMPLETE. A
 *  Markdown file whose images are links back into a private, password-protected
 *  server is a file that stops working the moment it leaves the machine — which
 *  defeats the point of exporting. An image that cannot be read is left as a
 *  reference rather than failing the export: the words are what matter most. */
export async function exportNoteAsMarkdown(note: Note): Promise<void> {
  const title = note.title?.trim() || tOutsideReact("note.untitled");
  const content = await inlineNoteImages(note.content, { skipFailures: true });
  const body = tiptapToMarkdown(content);
  // Lead with the title as an H1 so the file stands on its own, then the body.
  const markdown = (body ? `# ${title}\n\n${body}` : `# ${title}`).trimEnd() + "\n";
  downloadText(markdown, `${sanitizeFilename(note.title || "note")}.md`, "text/markdown");
}

/** Export an unlocked note to PDF via the browser's print-to-PDF (see NotePrintHost).
 *  Same lock gating as Markdown — a locked note has no plaintext content to render. */
export function exportNoteAsPdf(note: Note): void {
  printNote(note);
}
