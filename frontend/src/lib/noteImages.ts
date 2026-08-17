// Getting a picture out of the clipboard and into a note.
//
// Everything between "the user pressed paste" and "there is a row on the server" is
// here: what counts as an image, shrinking it so a phone photo doesn't become a
// twenty-megabyte note, uploading it, and — for locking — folding the stored bytes
// back into the document.
//
// NOTHING LEAVES THE SERVER YOU RUN. The file is read in the browser, resized in the
// browser, and posted to Lockpad's own API. No image host, no CDN, no "optimisation"
// service. That is the same promise the rest of the app makes, and it is the reason
// the resizing happens here rather than in a library on the way in.
import { api } from "./api";

// The formats a browser renders natively. Kept in step with the server's allowlist
// (backend/src/lib/noteImages.ts) — the server is the authority; this is what stops
// the user finding that out only after a slow upload.
export const ACCEPTED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** For the `accept` attribute of the file picker. */
export const IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_MIMES.join(",");

// Mirrors the server's default MAX_IMAGE_MB. A self-hoster who raises theirs will
// find this check simply never fires first; a lower one on the server still wins,
// and its message is the one shown. This exists to fail FAST and locally, not to be
// the rule.
const MAX_BYTES = 10 * 1024 * 1024;

// Longest edge kept after downscaling. 2560 is generous — it still fills a 5K
// display at full width and prints cleanly — while cutting a modern phone photo
// (often 4000px+) to roughly a quarter of its pixels. Notes are read, not zoomed.
const MAX_DIMENSION = 2560;

// JPEG/WebP quality for a re-encode. 0.85 is the point where artefacts stop being
// visible at normal viewing size on photographic content.
const REENCODE_QUALITY = 0.85;

export interface PreparedImage {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  /** A sensible description derived from the file name, used as the alt text. */
  alt: string;
}

export interface UploadedImage {
  id: string;
  src: string;
  mime: string;
  width: number;
  height: number;
  size: number;
}

/** A human-facing reason an image could not be used. Thrown (not returned) so a
 *  caller can wrap the whole paste-or-drop path in one try/catch. */
export class ImageError extends Error {}

/** Turn a file name into the picture's default description: "trip-photo_02.JPG" →
 *  "trip photo 02". Not a caption — it is what a screen reader announces, and a
 *  filename is very often the only description that will ever exist, so it is worth
 *  making the automatic one readable. */
function describeFromFilename(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a dropped/pasted item is something we can actually take. */
export function isSupportedImageFile(file: File): boolean {
  return (ACCEPTED_IMAGE_MIMES as readonly string[]).includes(file.type.toLowerCase());
}

/**
 * Validate a file and shrink it if it is bigger than a note needs.
 *
 * Two things worth knowing about what happens here:
 *
 *  - ANIMATED GIFs ARE PASSED THROUGH UNTOUCHED. Redrawing one onto a canvas keeps
 *    only the first frame, which turns an animation into a still without warning.
 *    A GIF is therefore only size-checked, never resized.
 *
 *  - RE-ENCODING STRIPS EXIF, which is a quiet privacy win: a photo straight off a
 *    phone usually carries the GPS coordinates of where it was taken, and a notes
 *    app that promises nothing leaves your server should not be the place those
 *    survive. `imageOrientation: "from-image"` is what keeps the picture the right
 *    way up once the orientation tag it depended on is gone.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const mime = file.type.toLowerCase();
  const alt = describeFromFilename(file.name);

  if (!isSupportedImageFile(file)) {
    // HEIC deserves its own sentence: it is what an iPhone shoots by default, so
    // this is the message most likely to be seen, and "unsupported file" would leave
    // the user with no idea what to do about it.
    if (/heic|heif/i.test(mime) || /\.hei[cf]$/i.test(file.name)) {
      throw new ImageError(
        "iPhone HEIC photos aren’t supported yet. In Settings › Camera › Formats, choose “Most Compatible”, or share the photo as a JPEG first."
      );
    }
    throw new ImageError("That file isn’t an image Lockpad can show. Use a JPEG, PNG, WebP or GIF.");
  }

  if (file.size > MAX_BYTES && mime === "image/gif") {
    throw new ImageError(`That GIF is larger than ${MAX_BYTES / 1024 / 1024}MB.`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError("That image file appears to be damaged and couldn’t be read.");
  }

  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  // A GIF keeps every frame; a small enough still is left exactly as it was, so a
  // crisp screenshot is never softened by a pointless round trip through a canvas.
  if (mime === "image/gif" || (longest <= MAX_DIMENSION && file.size <= MAX_BYTES)) {
    bitmap.close();
    return { blob: file, mime, width, height, alt };
  }

  const scale = Math.min(1, MAX_DIMENSION / longest);
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ImageError("Your browser couldn’t process that image.");
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // PNG stays PNG. It is what screenshots and diagrams arrive as, and turning one
  // into a JPEG puts ringing artefacts around every letter of the text in it —
  // exactly the content a screenshot exists to preserve.
  const outMime = mime === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outMime, outMime === "image/png" ? undefined : REENCODE_QUALITY)
  );
  if (!blob) throw new ImageError("Your browser couldn’t process that image.");

  if (blob.size > MAX_BYTES) {
    throw new ImageError(
      `That image is still over ${MAX_BYTES / 1024 / 1024}MB after resizing. Try saving it smaller first.`
    );
  }

  return { blob, mime: outMime, width: targetW, height: targetH, alt };
}

/** Send a prepared image to the note it belongs to. The response carries the `src`
 *  ready to put in the document, so no caller has to know how an image URL is spelled. */
export async function uploadNoteImage(noteId: string, image: PreparedImage): Promise<UploadedImage> {
  const form = new FormData();
  // The dimensions ride along as fields because the browser already decoded the
  // image and knows them; the server would otherwise need an image decoder purely to
  // recover two numbers it uses to reserve layout space.
  form.append("width", String(image.width));
  form.append("height", String(image.height));
  // The filename is required by the multipart encoding but never stored — the
  // description travels on the document node instead.
  form.append("file", image.blob, `image.${image.mime.split("/")[1] ?? "bin"}`);
  return api.postForm<UploadedImage>(`/notes/${noteId}/images`, form);
}

// ─── Folding pictures into a document ─────────────────────────────────────────
//
// Two jobs need a document that carries its pictures rather than pointing at them,
// and both are served by the same operation:
//
//   locking   a locked note's document is encrypted in the browser, so anything
//             that must be protected has to be INSIDE it before it is encrypted
//   export    a Markdown file whose images are links into a private server is a
//             file that only works while you are logged into that server

interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  [key: string]: unknown;
}

const SRC_PATTERN = /^\/api\/images\/([a-z0-9]+)$/i;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageError("An image in this note couldn’t be read."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Replace every stored-image reference in a document with the picture itself, as a
 * `data:` URI.
 *
 * FOR LOCKING, this is the step that makes the lock honest. Without it a locked
 * note's words would be ciphertext while its pictures stayed sitting on disk as
 * ordinary files — and for most notes worth locking, the screenshot IS the secret.
 * Once the images are inside the document, the existing encryption covers them with
 * no new key material, no second ciphertext to manage and no new way to get it
 * wrong; the server then deletes the now-redundant rows (backend/src/routes/lock.ts).
 * Unlocking is the mirror image, and happens server-side once the browser has handed
 * back the decrypted document.
 *
 * FOR EXPORT, it is what makes the resulting file stand on its own — openable years
 * later on a machine that has never heard of this server.
 *
 * `skipFailures` decides what an unreadable image costs. Locking must NOT skip: a
 * picture quietly left out would be a picture left readable on disk, which is the
 * one outcome locking exists to prevent, so it fails loudly instead. Export SHOULD
 * skip: getting the words out is worth more than refusing the whole file over one
 * broken image.
 */
export async function inlineNoteImages(
  doc: unknown,
  options: { skipFailures?: boolean } = {}
): Promise<unknown> {
  const srcs = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as DocNode;
    if (n.type === "image" && typeof n.attrs?.src === "string" && SRC_PATTERN.test(n.attrs.src)) {
      srcs.add(n.attrs.src);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  if (srcs.size === 0) return doc;

  // Fetched with credentials because the image endpoint sits behind the same session
  // guard as everything else — see lib/api.ts on why nothing is ever cross-origin.
  const inlined = new Map<string, string>();
  for (const src of srcs) {
    try {
      const response = await fetch(src, { credentials: "include" });
      if (!response.ok) throw new ImageError("An image in this note couldn’t be read.");
      inlined.set(src, await blobToDataUrl(await response.blob()));
    } catch (error) {
      if (!options.skipFailures) throw error;
      // Left pointing at the server: the note still exports, and the reference is
      // at least a record that something was there.
    }
  }
  if (inlined.size === 0) return doc;

  const map = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(map);
    const n = node as DocNode;
    const next: DocNode =
      n.type === "image" && typeof n.attrs?.src === "string" && inlined.has(n.attrs.src)
        ? { ...n, attrs: { ...n.attrs, src: inlined.get(n.attrs.src)! } }
        : n;
    return Array.isArray(next.content) ? { ...next, content: next.content.map(map) as DocNode[] } : next;
  };
  return map(doc);
}
