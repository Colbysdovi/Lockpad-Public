// Client-side file download helpers. Everything is generated in the browser and
// handed to the user as a local download — nothing is uploaded, consistent with
// Lockpad's nothing-leaves-your-hardware positioning.

// Turn a note title into a filesystem-safe base filename. Strips path separators
// and characters reserved on common filesystems, collapses whitespace, trims
// leading/trailing dots and spaces, and caps the length. Falls back to `fallback`
// when the result is empty.
export function sanitizeFilename(name: string, fallback = "note"): string {
  const cleaned = name
    .normalize("NFC")
    // Reserved on Windows/macOS/Linux: path separators, shell wildcards, pipes,
    // quotes, angle brackets. Spaces and hyphens are legal and kept for readability.
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") // no leading dots (hidden files / "..")
    .replace(/[.\s]+$/, "") // no trailing dots or spaces (Windows)
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

// Trigger a browser download of a Blob under `filename`, cleaning up the object URL.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download a string as a text file with the given MIME type. */
export function downloadText(text: string, filename: string, mime = "text/plain"): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}
