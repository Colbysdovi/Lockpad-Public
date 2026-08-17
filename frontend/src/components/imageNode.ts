import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { NoteImageView } from "./NoteImageView";
import { IMAGE_ACCEPT_ATTR, isSupportedImageFile } from "@/lib/noteImages";

// The image block in a note's body.
//
// A plain atom block, like the smart-link card, so it inherits every block behaviour
// the editor already has for free: the gutter handle drags it, selecting and pressing
// Backspace removes it, JSON export stores its attributes verbatim, and locking
// encrypts it along with everything else.
//
// ONLY OUR OWN PICTURES. `src` is either `/api/images/<id>` — a row on this server —
// or, inside a locked note that has been opened for viewing, the picture itself as a
// data URI. It is never a URL somewhere else, and `parseHTML` below is what enforces
// that: copying an image out of a web page and pasting it here drops the image rather
// than quietly embedding a hotlink that would phone home every time the note opened.
// Pasting the FILE (a screenshot, a photo, a drag from the desktop) is the supported
// path, and it uploads to your own server first.

export interface ImageUploadResult {
  src: string;
  alt: string;
  width: number;
  height: number;
}

// Only our own image endpoint, and only an id — no host, no path, no query.
const OWN_SRC = /^\/api\/images\/[a-z0-9]+$/i;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteImage: {
      /** Upload and insert these files, skipping anything that isn't an image. */
      insertImageFiles: (files: File[]) => ReturnType;
      /** Open the system file picker, then insert whatever is chosen. */
      pickImage: () => ReturnType;
    };
  }
}

export const NoteImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  // WHY THE UPLOADER LIVES IN STORAGE rather than in the extension's options: the
  // editor instance outlives the React component that created it (it is parked and
  // re-adopted so undo history survives closing a note — see lib/editorSession.ts),
  // so anything captured in the options at creation belongs to a mount that may be
  // long gone. `storage` is per-editor and writable at any time, so the component
  // currently on screen can always put its own handler here.
  addStorage() {
    return { upload: null as ((file: File) => Promise<ImageUploadResult | null>) | null };
  },

  addAttributes() {
    return {
      src: { default: "" },
      // The description a screen reader announces. Defaults to something derived
      // from the file name, because an image with no description at all is the one
      // outcome worth designing against.
      alt: { default: "" },
      // Intrinsic pixel size, used to reserve the right space before the bytes
      // arrive — without it a note full of photos reflows as it loads. These are the
      // picture's OWN dimensions and never change; how big it is *shown* is
      // widthPercent below.
      width: { default: null },
      height: { default: null },
      // How wide the picture is drawn, as a percentage of the writing column.
      //
      // A PERCENTAGE, NOT PIXELS, and that is the whole design. A note is read on a
      // 27-inch display and on a phone, and "620 pixels wide" means a comfortable
      // two-thirds of the column on one and an overflow on the other. A percentage
      // means the same thing everywhere: half the column stays half the column.
      //
      // `null` is not 100% — it means "no opinion", and the picture falls back to its
      // natural size, capped at the column width. That distinction matters, because a
      // small icon dropped into a note should stay small rather than being blown up
      // to fill the line.
      widthPercent: {
        default: null,
        parseHTML: (element) => {
          const raw = Number((element as HTMLElement).getAttribute("data-width-percent"));
          return Number.isFinite(raw) && raw > 0 ? Math.min(100, Math.max(10, Math.round(raw))) : null;
        },
        // Rendered as a data attribute rather than a real one — `widthPercent` is not
        // something an <img> understands, and letting it through would put a stray
        // `widthpercent="60"` in the markup.
        renderHTML: (attributes) =>
          attributes.widthPercent ? { "data-width-percent": String(attributes.widthPercent) } : {},
      },
    };
  },

  parseHTML() {
    return [
      // The caption is already stored on the node (as `alt`), so when a figure comes
      // back in, its figcaption is a duplicate — dropped rather than left to be parsed
      // as a stray paragraph under the picture.
      { tag: "figcaption", ignore: true },
      {
        tag: "img[src]",
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const src = el.getAttribute("src") ?? "";
          // Returning false rejects the match, so the <img> is dropped instead of
          // becoming a node pointing somewhere off this server. Note that a `data:`
          // URI is rejected here too: it is legitimate INSIDE a locked note's
          // decrypted document (which is loaded as JSON, not parsed from HTML), but
          // one arriving through the clipboard would sit in the live document being
          // re-uploaded on every autosave.
          if (!OWN_SRC.test(src)) return false;
          const number = (name: string) => {
            const value = Number(el.getAttribute(name));
            return Number.isFinite(value) && value > 0 ? value : null;
          };
          return { src, alt: el.getAttribute("alt") ?? "", width: number("width"), height: number("height") };
        },
      },
    ];
  },

  // Static markup — what the clipboard gets, and what the list-card preview renders
  // (NotePreview goes through generateHTML, where React node views do not apply).
  //
  // Always a `<figure>`, so one rule sizes the picture everywhere it is rendered —
  // the editor, a list card, the printed page. The `<figcaption>` is only added when
  // there is actually a description; an empty one would just be a blank line.
  //
  // The chosen width goes on the FIGURE rather than the image, so the caption is as
  // wide as the picture it belongs to and wraps under it — a caption running the full
  // column beneath a half-width image reads as loose prose, not as a label.
  renderHTML({ HTMLAttributes }) {
    const alt = String(HTMLAttributes.alt ?? "");
    const percent = Number(HTMLAttributes["data-width-percent"]) || null;
    const img = ["img", mergeAttributes(HTMLAttributes, { class: "note-image", draggable: "false" })];
    const figure: Record<string, string> = {
      class: percent ? "note-image-figure is-sized" : "note-image-figure",
    };
    if (percent) figure.style = `width:${percent}%`;
    const children: unknown[] = [img];
    if (alt) children.push(["figcaption", { class: "note-image-caption" }, alt]);
    return ["figure", figure, ...children] as never;
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteImageView);
  },

  addCommands() {
    return {
      insertImageFiles:
        (files) => ({ editor }) => {
          const images = files.filter(isSupportedImageFile);
          // Also accept files the browser gave no type for, so the uploader can
          // produce the proper "that's a HEIC" message rather than silent nothing.
          const candidates = images.length ? images : files.filter((f) => f.type.startsWith("image/") || !f.type);
          if (candidates.length === 0) return false;
          const upload = editor.storage.image.upload;
          if (!upload) return false;

          // Uploaded and inserted ONE AT A TIME, in the order they were given: each
          // insertion lands at the current cursor, so running them concurrently
          // would interleave several notes' worth of pictures in arrival order
          // rather than the order they were dropped.
          void (async () => {
            for (const file of candidates) {
              const result = await upload(file);
              if (!result || editor.isDestroyed) continue;
              editor.chain().focus().insertContent({ type: "image", attrs: result }).run();
            }
          })();
          return true;
        },

      pickImage:
        () => ({ editor }) => {
          if (!editor.storage.image.upload) return false;
          // Built fresh each time and thrown away after: a persistent hidden input
          // would have to be owned by some component, and this way the picker
          // belongs to the action rather than to a place in the tree.
          const input = document.createElement("input");
          input.type = "file";
          input.accept = IMAGE_ACCEPT_ATTR;
          input.multiple = true;
          input.style.display = "none";
          input.addEventListener("change", () => {
            const files = Array.from(input.files ?? []);
            input.remove();
            if (files.length) editor.commands.insertImageFiles(files);
          });
          document.body.appendChild(input);
          input.click();
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: new PluginKey("noteImageDrop"),
        props: {
          // Paste a screenshot straight from the clipboard. Runs after the editor's
          // own handlePaste (which only claims a paste that is a single bare URL),
          // so the two never contend.
          handlePaste: (_view, event) => {
            if (!editor.isEditable) return false;
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0 || !files.some((f) => f.type.startsWith("image/"))) return false;
            event.preventDefault();
            return editor.commands.insertImageFiles(files);
          },
          // Drop a file from the desktop. Dropping text or a node from within the
          // document is left alone — that is ProseMirror's own drag-and-drop, which
          // is how the gutter handle moves blocks around.
          handleDrop: (_view, event) => {
            if (!editor.isEditable) return false;
            const dropEvent = event as DragEvent;
            const files = Array.from(dropEvent.dataTransfer?.files ?? []);
            if (files.length === 0) return false;
            dropEvent.preventDefault();
            return editor.commands.insertImageFiles(files);
          },
        },
      }),
    ];
  },
});
