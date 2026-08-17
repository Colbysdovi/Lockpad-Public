import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { FileText } from "@/components/icons";
import { useLinks } from "@/lib/hooks";
import { useNoteSheet } from "@/lib/useNoteSheet";
import { liveHandlersForDom } from "@/lib/editorSession";
import { cn } from "@/lib/utils";

/**
 * How a note reference looks inside the editor: a small chip, in the flow of the
 * sentence, showing the target note's CURRENT title.
 *
 * ── Where the title comes from, and why it matters ──────────────────────────────
 *
 * Not from the node's stored `title` attr. That attr is a snapshot taken when the
 * link was made, and a snapshot goes stale the moment the target is renamed —
 * leaving the reader looking at a label that quietly disagrees with the note it
 * points at. Instead the chip reads the source note's own link list, which the
 * server resolves fresh (`GET /notes/:id/links` joins the target and returns its
 * title). Rename a note and every chip pointing at it says the new name.
 *
 * That one query answers all three questions the chip needs to ask, which is why it
 * is the right source rather than a convenient one:
 *   • the current title      — the join returns it
 *   • does the target exist  — the query excludes deleted/trashed notes
 *   • is the link still real — an unlink from the Links row drops it from the list
 *
 * So a target that is deleted, trashed, or unlinked from the metadata panel all
 * arrive at the SAME answer, and the chip has exactly one broken state to render
 * instead of three that could drift apart (PRD §3.3).
 *
 * ── The inert state ─────────────────────────────────────────────────────────────
 *
 * A broken chip stays visible. Silently deleting it would edit someone's prose
 * behind their back, and silently leaving it live would let it lie. It is struck
 * through, dimmed, given a title attribute saying what happened, and it stops being
 * clickable — struck-through text carries the meaning without colour, so it survives
 * a reader who cannot tell dim terracotta from live terracotta (PRD §5).
 */
export function NoteLinkView({ node, editor }: NodeViewProps) {
  const targetId = String(node.attrs.noteId ?? "");
  const snapshot = String(node.attrs.title ?? "").trim();
  const { openNote } = useNoteSheet();

  // The note this chip is written IN. Read from the editor registry rather than the
  // extension's options: an editor instance is re-adopted across mounts to carry undo
  // history, so anything baked into its options at construction belongs to an older
  // mount and can name the wrong note. Same reasoning as bindLiveHandlers.
  const sourceId = liveHandlersForDom(editor.view.dom)?.noteId;
  const links = useLinks(sourceId ?? "");

  const target = links.data?.links.find((l) => l.id === targetId);
  // Only call it broken once we have actually heard back. While the query is in
  // flight every chip would otherwise flash struck-through on open, which reads as
  // "all your links are broken" for as long as the request takes.
  const resolved = !links.data || !!target;
  const label = target?.title?.trim() || snapshot || "Untitled";

  return (
    <NodeViewWrapper as="span" className="note-link" contentEditable={false}>
      <a
        className={cn("note-link-chip", !resolved && "is-broken")}
        // A real href so the chip is a link to assistive tech and to a middle-click,
        // and so its accessible name says both what it is and where it goes.
        href={resolved ? `/?note=${targetId}` : undefined}
        aria-label={resolved ? `Open the note “${label}”` : `“${label}” — this note is no longer linked or no longer exists`}
        title={resolved ? undefined : "This note was deleted or unlinked"}
        onClick={(e) => {
          if (!resolved) return;
          // Open in the app's own sheet rather than letting the browser navigate:
          // the href exists for the keyboard and the middle click, not for this path.
          e.preventDefault();
          e.stopPropagation();
          openNote(targetId);
        }}
      >
        <FileText className="note-link-icon h-3.5 w-3.5" aria-hidden />
        <span className="note-link-title">{label}</span>
      </a>
    </NodeViewWrapper>
  );
}
