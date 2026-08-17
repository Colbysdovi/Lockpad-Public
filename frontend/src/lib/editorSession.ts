import type { Editor } from "@tiptap/react";

// Session-persistent undo history for notes.
//
// ProseMirror's history plugin already gives real character-level undo/redo inside
// an open note — but that history lives in the editor instance, which TipTap
// destroys the moment the note closes. Edit a note, look at another one, come back:
// the history is gone, even though nothing about the data changed and the tab never
// reloaded. That is the papercut this fixes.
//
// WHY WE PARK THE WHOLE EDITOR rather than its EditorState. Serialising the history
// plugin's state is not something ProseMirror supports, and transplanting a raw
// EditorState into a fresh view does not work either: every TipTap Editor builds its
// OWN Schema and its OWN plugin instances (which close over `this.editor`), so a
// state carried over from a destroyed editor would drive the new view through the
// dead one's plugins. Keeping the instance alive sidesteps the whole class of
// problem — and TipTap supports it directly: EditorContent moves the editor's DOM
// into a detached div on unmount and re-adopts it on the next mount, precisely so an
// editor can outlive the component rendering it.
//
// Everything here is in memory and dies with the tab. That is deliberate (see the
// idea brief): no schema change, no persistence layer, no undo across reloads.

/** How many notes keep their history at once. Each entry holds a live editor with a
 *  full document and up to 100 history steps, so this is a memory ceiling, not a
 *  behavioural one — past it, the least-recently-parked note loses its history. */
const CAP = 12;

interface Parked {
  editor: Editor;
  /** Canonical doc the editor held when it was parked. */
  doc: string;
  /** Canonical content the editor was originally hydrated from. */
  source: string;
}

// Insertion-ordered, so the first key is always the least-recently-parked one.
const parked = new Map<string, Parked>();

/** Canonical form of a note's content, for comparing two documents by value.
 *  Exported so the caller can record what it hydrated a fresh editor from. */
export function canonicalContent(content: unknown): string {
  return canonical(content);
}

/** Stable stringify. The content comes back from Postgres as `jsonb`, which does NOT
 *  preserve key order, so the same document can round-trip with its keys shuffled
 *  relative to what the editor emitted. Sorting keys makes the freshness comparison
 *  about content rather than about key order. */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function discard(key: string) {
  const entry = parked.get(key);
  if (!entry) return;
  parked.delete(key);
  if (!entry.editor.isDestroyed) entry.editor.destroy();
}

/**
 * Reclaim this note's parked editor, or null if there isn't a usable one.
 *
 * Resuming is only safe while the server still agrees with the editor we parked, so
 * the parked editor is reused ONLY when the incoming content matches either:
 *   - the doc it held when parked — the normal case, where our own autosave is what
 *     wrote that content; or
 *   - the content it was first hydrated from — the case where a save is still in
 *     flight (or failed), so the server is a beat behind. Resuming here is the SAFE
 *     branch, not the risky one: the parked editor holds the newer text, and
 *     dropping it would throw the user's unflushed edits away.
 *
 * Anything else means the note moved on without us (a JSON import overwrote it,
 * another tab edited it), so the stale editor is destroyed and the caller builds a
 * fresh one against the real content.
 *
 * The entry is removed on success: an editor that is mounted somewhere must never
 * also be sitting in the pool where a second mount could adopt it.
 */
export function takeSessionEditor(
  key: string,
  content: unknown
): { editor: Editor; source: string } | null {
  const entry = parked.get(key);
  if (!entry) return null;
  if (entry.editor.isDestroyed) {
    parked.delete(key);
    return null;
  }
  const incoming = canonical(content);
  if (incoming !== entry.doc && incoming !== entry.source) {
    discard(key);
    return null;
  }
  parked.delete(key);
  return { editor: entry.editor, source: entry.source };
}

/** Park an editor for later, evicting the least-recently-parked note past the cap.
 *  `source` is the canonical content the editor was hydrated from — fixed for the
 *  life of the instance, so it is threaded back in by the caller; the doc is
 *  re-read on every park. */
export function parkSessionEditor(key: string, editor: Editor, source: string) {
  if (editor.isDestroyed) return;
  // Re-inserting moves the key to the end of the Map's order — this IS the LRU bump.
  parked.delete(key);
  parked.set(key, { editor, doc: canonical(editor.getJSON()), source });
  while (parked.size > CAP) discard(parked.keys().next().value as string);
}

/** Forget a note's history and free the editor holding it. Locking a note goes
 *  through here: a parked editor keeps the plaintext AND every step needed to
 *  reconstruct it, which is not something a locked note should leave lying around. */
export function dropSessionEditor(key: string) {
  discard(key);
}

// ── Live callbacks ──────────────────────────────────────────────────────────
//
// An editor built on one mount can be adopted by another (that is the whole point
// of parking it), and its options — including onUpdate/onBlur — are frozen at
// construction. So a re-adopted editor keeps calling the FIRST mount's callbacks:
// the note still saves, because that mount's autosave hook is a closure and goes on
// working, but every bit of state it sets (the "Saving…/Saved" indicator above all)
// lands on a component that is no longer on screen. The visible note then looks like
// it is not saving at all.
//
// Reading through a per-mount ref does not fix this, because the ref OBJECT is
// per-mount too: mount two hands out a different ref, and the editor still holds
// mount one's. The registry below is keyed by the editor instance itself, so
// whichever component is currently rendering an editor owns its callbacks.
export interface LiveHandlers {
  onChange?: (doc: unknown) => void;
  onBlur?: () => void;
  onLinkTrigger?: () => void;
  /** Where the `[[` that opened the link picker sits in the document, so that
   *  choosing a note can replace those two characters rather than leaving them in
   *  the prose. Written by the editor's own handleTextInput, which is handed a
   *  ProseMirror view and cannot safely reach a per-mount ref. */
  noteLinkRange?: { from: number; to: number };
  /** Which note this editor is currently showing. Not a callback, but it belongs to
   *  the same registry for the same reason: an inline note-link chip needs to know
   *  the note it is written IN (to resolve its target through that note's links), and
   *  a re-adopted editor's options still name whatever note the earlier mount had. */
  noteId?: string;
}

const live = new WeakMap<Editor, LiveHandlers>();
// The same handlers, reachable from a bare ProseMirror view: `editorProps` callbacks
// (handleTextInput and friends) are handed a view, not the TipTap editor, and the
// view's DOM node is the one thing that identifies the instance from in there.
const liveByDom = new WeakMap<Node, LiveHandlers>();

/** Point an editor's callbacks at the mount that is showing it. Returns the
 *  un-bind, which only clears the entry if it is still this mount's — so a parked
 *  editor can never call into a component that has gone away. */
export function bindLiveHandlers(editor: Editor, handlers: LiveHandlers) {
  live.set(editor, handlers);
  const dom = editor.view?.dom;
  if (dom) liveByDom.set(dom, handlers);
  return () => {
    if (live.get(editor) === handlers) live.delete(editor);
    if (dom && liveByDom.get(dom) === handlers) liveByDom.delete(dom);
  };
}

/** The callbacks of whichever mount currently owns this editor, if any. */
export function liveHandlers(editor: Editor): LiveHandlers | undefined {
  return live.get(editor);
}

/** Same, from inside an `editorProps` handler, which only ever sees the view. */
export function liveHandlersForDom(dom: Node): LiveHandlers | undefined {
  return liveByDom.get(dom);
}
