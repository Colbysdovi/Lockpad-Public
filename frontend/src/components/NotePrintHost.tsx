import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Note } from "@/lib/types";
import { tiptapToHtml } from "@/lib/tiptapHtml";

// PDF export via the browser's own print-to-PDF (export PRD's recommended approach):
// render the note into a print-only portal and invoke window.print(). A dedicated
// `@media print` stylesheet (see index.css `.note-print`) turns that portal into the
// whole page — serif title, sans body, real checkbox glyphs, monospace code — so the
// PDF is an exact, self-hosted render with no PDF library and no CDN fonts.

// Module-level trigger so any surface (note menu, card) can request a print without
// prop-drilling a handler down to it — mirrors the single-instance host pattern.
let requestPrint: ((note: Note) => void) | null = null;

/** Print an unlocked note to PDF. No-op until <NotePrintHost/> has mounted. */
export function printNote(note: Note): void {
  requestPrint?.(note);
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Mounted once at the app root. Holds the note currently being printed and renders it
// into a body-level portal; clears itself when printing finishes.
export function NotePrintHost() {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    requestPrint = (n) => setNote(n);
    return () => { requestPrint = null; };
  }, []);

  useEffect(() => {
    if (!note) return;
    let cleared = false;
    const clear = () => { if (!cleared) { cleared = true; setNote(null); } };
    // This effect runs after React has committed the portal to the DOM, so the print
    // markup already exists. Wait only for web fonts (Newsreader) to be ready — a
    // microtask that resolves even in a backgrounded tab — then print. (Deliberately
    // NOT requestAnimationFrame: rAF is paused while the tab is hidden.)
    let printed = false;
    const fontsReady = (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve();
    // Images have to be DECODED before printing, not merely requested: the print
    // dialog snapshots the page as it stands, so a photo still in flight prints as a
    // blank gap. `decode()` resolves once the bitmap is ready to paint; a failure
    // resolves too, because one unreachable picture must not hang the whole print.
    const imagesReady = () => {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".note-print-portal img"));
      return Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    };
    Promise.all([fontsReady, imagesReady()]).then(() => {
      if (printed) return;
      printed = true;
      window.addEventListener("afterprint", clear, { once: true });
      window.print();
    });
  }, [note]);

  if (!note) return null;

  return createPortal(
    <div className="note-print-portal">
      <article className="note-print">
        <h1 className="note-print-title">{note.title?.trim() || "Untitled"}</h1>
        <div className="note-print-dates">
          Created {formatStamp(note.createdAt)} · Edited {formatStamp(note.updatedAt)}
        </div>
        {/* HTML is serialized + escaped from the note's own TipTap content (see
            tiptapToHtml) — safe to inject; note text can't smuggle in markup. */}
        <div className="note-print-body" dangerouslySetInnerHTML={{ __html: tiptapToHtml(note.content) }} />
      </article>
    </div>,
    document.body,
  );
}
