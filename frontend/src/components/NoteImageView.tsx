import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Trash2 } from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * How a picture looks inside a note: the image, with its description written
 * underneath it as a caption.
 *
 * THE DESCRIPTION IS VISIBLE, AND THAT IS THE POINT. It started life as alt text —
 * something only a screen reader would ever reach — and the trouble with alt text is
 * that nobody writes it, because nobody can see whether it is there. Put it under the
 * picture as an ordinary caption and it becomes part of the note: you see it, so you
 * notice when it is wrong, and fixing it is a click rather than a trip through a menu.
 * The caption IS the edit affordance; there is no separate "edit description" button.
 *
 * It is seeded from the file name at insert time ("holiday-sunset.png" → "holiday
 * sunset"), so a picture arrives already described, however roughly. Clearing it is
 * allowed: an image that genuinely carries no meaning is better with no caption than
 * with a made-up one.
 *
 * ACCESSIBILITY. The description must be announced exactly once, so which element
 * carries it depends on the mode. While editing, the caption is a real button and the
 * `<img>` is left with an empty alt — the figure takes its name from the caption, and
 * the button says what pressing it will do. Read-only, there is no button, so the alt
 * does the announcing and the caption is hidden from assistive tech as the visual
 * duplicate it is.
 *
 * `width`/`height` are set as real attributes, not just CSS, so the browser knows the
 * aspect ratio before the bytes arrive and the note lays out once instead of jolting
 * downwards as each picture loads.
 *
 * RESIZING is the pill on the bottom edge: drag it down to make the picture bigger,
 * up to make it smaller. Only one dimension is ever chosen — the other follows from
 * the image's own proportions — because a control that can squash a photograph is a
 * control that will eventually squash a photograph. See the drag code below for why
 * the size is only written to the document when the drag ENDS.
 */
export function NoteImageView({ node, editor, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const width = Number(node.attrs.width) || undefined;
  const height = Number(node.attrs.height) || undefined;
  const editable = editor.isEditable;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(alt);
  const inputRef = useRef<HTMLInputElement>(null);
  // A picture that fails to load is worth saying out loud rather than leaving as a
  // broken glyph — the likeliest cause is that its note was locked (and the bytes
  // moved into the ciphertext) in another tab.
  const [failed, setFailed] = useState(false);

  // ── Size ───────────────────────────────────────────────────────────────────
  const storedPercent = Number(node.attrs.widthPercent) || null;
  // The width being dragged right now, kept in component state rather than in the
  // document. Writing every pointermove to the document would be correct and awful:
  // sixty transactions a second, each one an undo step, so undoing a resize would
  // mean pressing Ctrl+Z until your finger hurt. The document is written once, on
  // release, and the whole resize is a single undo.
  const [draggingPercent, setDraggingPercent] = useState<number | null>(null);
  const shownPercent = draggingPercent ?? storedPercent;
  const figureRef = useRef<HTMLElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Never smaller than a tenth of the column (below that it stops being a picture and
  // becomes a smudge), never wider than the column itself.
  const MIN_PERCENT = 10;
  const MAX_PERCENT = 100;
  const clamp = (value: number) => Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(value)));

  /** What fraction of the column the picture currently occupies.
   *
   *  A stored size is believed outright; the DOM is only measured when there isn't
   *  one, so that the first nudge of an as-yet-unsized picture starts exactly where
   *  it already sits instead of jumping. Preferring the stored value is not just
   *  cheaper — holding an arrow key fires far faster than React re-renders, and
   *  measuring would keep reading the size from before the previous keypress, so the
   *  picture would stick after one step. */
  const currentPercent = useCallback((): number => {
    if (storedPercent) return storedPercent;
    const figure = figureRef.current;
    const column = figure?.parentElement;
    if (!figure || !column || column.clientWidth === 0) return MAX_PERCENT;
    return clamp((figure.getBoundingClientRect().width / column.clientWidth) * 100);
  }, [storedPercent]);

  const applyPercent = (percent: number) => updateAttributes({ widthPercent: clamp(percent) });

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editable) return;
    const figure = figureRef.current;
    const column = figure?.parentElement;
    if (!figure || !column) return;
    event.preventDefault();
    event.stopPropagation();

    const startY = event.clientY;
    const startWidth = figure.getBoundingClientRect().width;
    const columnWidth = column.clientWidth || 1;
    // The picture's own proportions, so a vertical drag can be turned into a width.
    // Falls back to the loaded bitmap when the stored dimensions are missing (an old
    // note, or an import), and to a square as a last resort.
    const naturalW = Number(node.attrs.width) || imgRef.current?.naturalWidth || 1;
    const naturalH = Number(node.attrs.height) || imgRef.current?.naturalHeight || 1;
    const ratio = naturalW / naturalH;

    // Tracked on the WINDOW, not on the grip. A resize drag routinely travels well
    // outside a 72-pixel pill — that is rather the point of dragging — and listening
    // on the grip itself would drop the gesture the moment the pointer left it. This
    // is the same shape as the block drag in blockDragHandle.ts, and it needs no
    // pointer capture (which can refuse, and then silently strands the drag).
    let latest = clamp((startWidth / columnWidth) * 100);
    const onMove = (move: PointerEvent) => {
      // Pulling the bottom edge DOWN makes the picture taller, and the width follows
      // from the ratio — which is what keeps a photograph a photograph.
      const nextWidth = startWidth + (move.clientY - startY) * ratio;
      latest = clamp((nextWidth / columnWidth) * 100);
      setDraggingPercent(latest);
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      setDraggingPercent(null);
      applyPercent(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  // Keyboard resizing, in five-point steps. Right/Down grow, Left/Up shrink: Down
  // grows because it mirrors the drag (you are pulling the bottom edge downwards),
  // and Right grows because that is what an arrow key does to any other slider.
  const onResizeKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 5
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -5
      : 0;
    if (step === 0) return;
    event.preventDefault();
    applyPercent(currentPercent() + step);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(alt);
    setEditing(true);
  };

  const commit = () => {
    updateAttributes({ alt: draft.trim() });
    setEditing(false);
  };

  const cancel = () => {
    setDraft(alt);
    setEditing(false);
  };

  return (
    <NodeViewWrapper
      className={cn("note-image-block group/image relative my-4", selected && "is-selected")}
      // Deliberately NOT `data-drag-handle`: that would make the picture itself a
      // native HTML5 drag source, which fights the pointer-based gutter drag every
      // other block uses (and which cannot work on touch at all). The image is moved
      // by the grip in the left margin, exactly like a paragraph.
      contentEditable={false}
      draggable={false}
    >
      {failed ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed px-3.5 py-4 text-sm text-muted-foreground">
          <span>This image couldn’t be loaded{alt ? `: “${alt}”` : "."}</span>
        </div>
      ) : (
        <figure
          ref={figureRef}
          className={cn(
            "note-image-figure",
            shownPercent && "is-sized",
            draggingPercent !== null && "is-resizing"
          )}
          style={shownPercent ? { width: `${shownPercent}%` } : undefined}
        >
          {/* The picture and its grip share a frame of their own, INSIDE the figure.
              Anchoring the grip to the figure instead would put it at the bottom of
              the figure — which is below the caption, not on the edge of the
              picture, so it would read as belonging to the text. */}
          <div className="note-image-frame">
            <img
              ref={imgRef}
              src={src}
              // Empty while the caption below is a live control announcing the same
              // words — see the accessibility note above.
              alt={editable ? "" : alt}
              width={width}
              height={height}
              draggable={false}
              onError={() => setFailed(true)}
              className="note-image"
            />

          {/* The resize grip: a chip straddling the bottom edge.
              Hidden until the picture is hovered or selected — the same rule the
              delete button follows, so a note full of photographs reads as a page
              rather than as a control panel — but never hidden from the keyboard, and
              never hidden on touch, where no hover exists to reveal it (see
              index.css).
              A slider rather than a button, because that is what it is: a continuous
              value with a floor and a ceiling, and saying so is what lets a screen
              reader announce "60 percent" as it changes. Double-click puts the picture
              back to its natural size, which is the one value a drag can never quite
              hit. */}
          {editable && (
            <div
              role="slider"
              tabIndex={0}
              aria-label="Resize image"
              aria-orientation="horizontal"
              aria-valuemin={MIN_PERCENT}
              aria-valuemax={MAX_PERCENT}
              aria-valuenow={shownPercent ?? MAX_PERCENT}
              aria-valuetext={`${shownPercent ?? 100}% of the column width`}
              title="Drag to resize · double-click to reset"
              onPointerDown={startResize}
              onKeyDown={onResizeKeyDown}
              onDoubleClick={() => updateAttributes({ widthPercent: null })}
              // The grip sits on a draggable block; without this, grabbing it would
              // start moving the picture up the note instead of resizing it.
              onMouseDown={(e) => e.stopPropagation()}
              className="note-image-resize"
            >
              <span aria-hidden className="note-image-resize-bar">
                {/* An up/down chevron pair, NOT grip dots. Three dots in a row is the
                    "more options" glyph everywhere on the web (this app included — the
                    note header uses it), so a dotted pill invites a click that opens a
                    menu, and a menu never comes. The chevrons say the two things this
                    control actually needs to say: that it moves, and that it moves
                    vertically. */}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 9.5 12 5.5l4 4" />
                  <path d="M8 14.5 12 18.5l4-4" />
                </svg>
              </span>
            </div>
          )}
          </div>

          {editing ? (
            <figcaption className="note-image-caption" contentEditable={false}>
              <input
                ref={inputRef}
                type="text"
                value={draft}
                placeholder="Describe this image…"
                aria-label="Image description"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commit(); }
                  else if (e.key === "Escape") { e.preventDefault(); cancel(); }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="note-image-caption-input"
              />
            </figcaption>
          ) : editable ? (
            <figcaption className="note-image-caption" contentEditable={false}>
              <button
                type="button"
                aria-label={alt ? `Edit description: ${alt}` : "Add a description"}
                onClick={startEditing}
                // The caption sits on a draggable node; without this, pressing it
                // starts a block drag instead of opening the field.
                onMouseDown={(e) => e.stopPropagation()}
                className={cn("note-image-caption-edit", !alt && "is-empty")}
              >
                {alt || "Add a description"}
              </button>
            </figcaption>
          ) : (
            // Read-only: the alt attribute is doing the announcing, so this is the
            // visual copy and nothing more. Omitted entirely when there is no
            // description, rather than leaving an empty line under the picture.
            alt !== "" && (
              <figcaption className="note-image-caption" aria-hidden="true">
                <span className="note-image-caption-text">{alt}</span>
              </figcaption>
            )
          )}
        </figure>
      )}

      {/* Removing the picture is the only thing left that needs a button of its own:
          it is destructive, and it should not be something the caption can do by
          accident. Hidden until hovered or selected — a page of photographs should
          not look like a file manager — but never hidden from the keyboard. */}
      {editable && !failed && (
        <div
          className={cn(
            "absolute right-2 top-2 rounded-lg border bg-[color-mix(in_srgb,var(--card)_95%,transparent)] p-1 shadow-md backdrop-blur",
            "opacity-0 transition-opacity focus-within:opacity-100 group-hover/image:opacity-100",
            selected && "opacity-100"
          )}
          contentEditable={false}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
        >
          <Tooltip label="Remove image">
            <button
              type="button"
              aria-label="Remove image"
              onClick={() => deleteNode()}
              className="icon-press rounded-md p-1.5 text-muted-foreground hover-scrim hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      )}
    </NodeViewWrapper>
  );
}
