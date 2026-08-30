import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMatch } from "react-router-dom";
import { Upload } from "@/components/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useT, useFormat } from "@/lib/i18n";

/** What the server says it FOUND in the uploaded files, before anything is written.
 *  `folderPath` is a slash-separated path the server will create if it doesn't
 *  exist; `createdAt` is whatever original date it could recover from the file. */
interface PreviewNote { title: string; preview: string; tags: string[]; folderPath: string | null; createdAt: string | null }

// Bringing notes in from somewhere else.
//
// Accepts CSV, a Lockpad JSON export, HTML (a Google Keep / Evernote dump), and
// plain Markdown or text files, one note per file or many per file depending on the
// format. Parsing lives entirely on the server (backend/src/lib/import.ts).
//
// The flow is deliberately TWO STEPS — preview, then commit — because an import is
// the one action that can add hundreds of notes at once and there is no bulk undo
// for it. The preview parses the same files through the same code that will do the
// real work and shows exactly what would be created, so the decision is made with
// the actual result in view rather than a filename and hope.
//
// The files are uploaded twice as a result (once to preview, once to commit). That
// is a deliberate trade: it means the server holds no half-finished import state
// between the two steps, and a user who walks away leaves nothing behind.
//
// Like a new note, an import inherits its context: run from a folder page and the
// notes land in that folder; from a tag page and they arrive tagged.
export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const format = useFormat();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<PreviewNote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderMatch = useMatch("/folders/:id");
  const tagMatch = useMatch("/tags/:id");

  const reset = () => { setFiles([]); setPreview(null); setError(null); };

  // Multipart, because these are real files — api.postForm deliberately skips JSON
  // encoding so the browser sets the multipart boundary itself.
  const buildForm = (fs: File[]) => {
    const form = new FormData();
    for (const f of fs) form.append("file", f);
    return form;
  };

  const runPreview = async (fs: File[]) => {
    if (!fs.length) return;
    setBusy(true); setError(null);
    try {
      const res = await api.postForm<{ count: number; notes: PreviewNote[] }>("/import/preview", buildForm(fs));
      setPreview(res.notes);
    } catch {
      setError(t("import.parseFailed"));
    } finally { setBusy(false); }
  };

  const onSelect = (list: FileList | null) => {
    if (!list) return;
    const fs = Array.from(list);
    setFiles(fs);
    runPreview(fs);
  };

  // The real write. Invalidates notes, folders AND tags afterwards, since an import
  // can create all three (a folder path and tag names are made on demand).
  const commit = async () => {
    setBusy(true); setError(null);
    try {
      const ctx = new URLSearchParams();
      if (folderMatch) ctx.set("folderId", folderMatch.params.id!);
      if (tagMatch) ctx.set("tagId", tagMatch.params.id!);
      const q = ctx.toString() ? `?${ctx}` : "";
      await api.postForm(`/import/commit${q}`, buildForm(files));
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      reset();
      onOpenChange(false);
    } catch {
      setError(t("import.failed"));
    } finally { setBusy(false); }
  };

  return (
    // Closing always resets: a half-finished preview should not still be sitting
    // there next time the dialog is opened, offering to import files the user has
    // long since forgotten choosing.
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent mobileSheet className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription>
            {t("import.description")}
          </DialogDescription>
        </DialogHeader>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onSelect(e.dataTransfer.files); }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground hover-scrim"
        >
          <Upload className="h-6 w-6" />
          {t("import.drop")}
          <input
            type="file"
            multiple
            accept=".csv,.json,.html,.htm,.md,.markdown,.txt"
            className="hidden"
            onChange={(e) => onSelect(e.target.files)}
          />
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {preview && (
          <div className="max-h-64 overflow-y-auto overscroll-contain rounded-md border">
            <div className="border-b bg-muted px-3 py-1.5 text-xs font-medium">
              {preview.length} note{preview.length === 1 ? "" : "s"} to import
            </div>
            {preview.map((n, i) => (
              <div key={i} className="border-b px-3 py-2 last:border-b-0">
                <div className="font-medium">{n.title}</div>
                <div className="line-clamp-1 text-xs text-muted-foreground">{n.preview}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {n.folderPath && <span className="rounded bg-secondary px-1">{n.folderPath}</span>}
                  {n.tags.map((t) => <span key={t} className="rounded bg-accent px-1">#{t}</span>)}
                  {n.createdAt && (
                    <span className="ml-auto whitespace-nowrap">
                      {format.longDate(n.createdAt)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={commit} disabled={busy || !preview || preview.length === 0}>
            {busy ? t("import.importing") : t("import.confirm", { count: preview?.length ?? 0 })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
