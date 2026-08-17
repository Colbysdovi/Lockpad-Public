import { useEffect, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { CornerDownLeft } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { FolderSelect, TagMultiSelect } from "./selectors";
import { useCreateNote } from "@/lib/hooks";
import { useNoteSheet } from "@/lib/useNoteSheet";
import { useIsMobile } from "@/lib/useIsMobile";
import { EASE_FOLLOW, EASE_FOLLOW_REVERSED } from "@/lib/motion";

// Floating quick-create bar near the bottom of list views (replaces the old FAB).
// Folder/tag selectors are pre-filled from the current page context (spec §3.8).
//
// `onFocusChange` lets the parent list mirror the composer's focused state so the
// bottom-of-list fade can deepen alongside the bar's own lift. The state stays
// OWNED here rather than being lifted into a controlled prop: this component is the
// only thing that knows all the ways focus really ends (blur with an empty body,
// a click outside, Escape, submitting, being pushed off screen by an opening note).
// Splitting that decision across two components is exactly how the fade and the bar
// would drift out of sync. The parent only listens.
export function NoteBar({ onFocusChange }: { onFocusChange?: (focused: boolean) => void }) {
  const folderMatch = useMatch("/folders/:id");
  const tagMatch = useMatch("/tags/:id");
  const create = useCreateNote();
  const { openNote, noteId } = useNoteSheet();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();

  const [body, setBody] = useState("");
  const [folderId, setFolderId] = useState<string | null>(folderMatch?.params.id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(tagMatch?.params.id ? [tagMatch.params.id] : []);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // On phones the bar collapses to a single line when idle; the Create button and
  // folder/tag row only appear once you focus it or start typing, reclaiming
  // vertical space. On desktop it's always fully expanded.
  const expanded = !isMobile || focused || body.trim().length > 0;

  useEffect(() => {
    setFolderId(folderMatch?.params.id ?? null);
  }, [folderMatch?.params.id]);
  useEffect(() => {
    setTagIds(tagMatch?.params.id ? [tagMatch.params.id] : []);
  }, [tagMatch?.params.id]);

  // Grow the textarea with its content so a long idea is fully visible before
  // creating it (caps at ~40vh, then scrolls).
  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  };
  useEffect(autoGrow, [body]);

  // Re-measure on resize as well as on typing. autoGrow writes an EXPLICIT height,
  // and the right height depends on the viewport twice over: the min-height drops
  // from 44px to 36px at the sm: breakpoint, and a narrower bar wraps the text into
  // more lines. Without this, a height worked out on a phone survives a rotate or a
  // window resize — a 44px box on desktop, where the CSS asks for 36, which pushes
  // the single line of text 4px above the Create button it is supposed to sit level
  // with. Same class of bug as the padding above, arriving by a different route.
  useEffect(() => {
    window.addEventListener("resize", autoGrow);
    return () => window.removeEventListener("resize", autoGrow);
  }, []);

  // Collapse when focus leaves the whole bar and nothing has been typed. The
  // relatedTarget check keeps it open while tapping the Create button or the
  // folder/tag triggers (which live inside the card).
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (body.trim()) return;
    const next = e.relatedTarget as Node | null;
    if (next && cardRef.current?.contains(next)) return;
    setFocused(false);
  };

  // Report focus upward so the list's bottom fade can follow it. One-way: the
  // parent never sets it back.
  useEffect(() => {
    onFocusChange?.(focused);
  }, [focused, onFocusChange]);

  // ...and always report "not focused" on unmount. The composer is REPLACED by the
  // bulk-action bar the moment a second note is selected, so without this the fade
  // would stay deepened with no composer left on screen to justify it.
  useEffect(() => () => onFocusChange?.(false), [onFocusChange]);

  // Two explicit ways out of the focused state, beyond simply tabbing away.
  //
  // Clicking anywhere else, or pressing Escape, returns the composer to idle. Both
  // deliberately ignore the "has unsent text" rule that `handleBlur` observes: that
  // rule exists so the bar doesn't collapse under you while you're still writing,
  // but once you've clicked away or pressed Escape you have said you're done
  // looking at it, and a composer left lifted and glowing over a dimmed list while
  // your attention is elsewhere is the stuck state this whole behaviour is meant to
  // avoid. Nothing is lost either way — the draft text stays exactly where it is,
  // and on mobile the bar stays expanded while it holds any, so nothing jumps.
  useEffect(() => {
    if (!focused) return;
    const toIdle = () => {
      setFocused(false);
      textareaRef.current?.blur();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (cardRef.current?.contains(target)) return;
      // The folder and tag pickers open in a Radix portal, which is OUTSIDE the
      // card in the DOM even though it belongs to it on screen. Without this,
      // choosing a folder for the note you're composing would read as clicking away.
      if (target.closest("[data-radix-popper-content-wrapper], [role='dialog']")) return;
      toIdle();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") toIdle();
    };
    // Capture phase, so a card that stops propagation on its own pointerdown can't
    // leave the composer stranded in the focused state.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [focused]);

  const submit = async () => {
    // The typed text becomes the note BODY (people think of the idea before the
    // title). Each line becomes a paragraph. Title stays "Untitled".
    const text = body.trim();
    const content = text
      ? {
          type: "doc",
          content: text.split("\n").map((line) =>
            line.trim()
              ? { type: "paragraph", content: [{ type: "text", text: line }] }
              : { type: "paragraph" }
          ),
        }
      : undefined;
    const note = await create.mutateAsync({
      content,
      folderId: folderId ?? undefined,
      tagIds: tagIds.length ? tagIds : undefined,
    });
    setBody("");
    setFocused(false);
    // Land the caret at the end of the text we just seeded into the note body.
    openNote(note.id, undefined, { focusBody: true });
  };

  // On desktop the floating note panel slides in over the list, so the composer
  // gets pushed straight down out of the viewport while a note is open (it slides
  // back up on close). It stays mounted so the motion can play both ways. On mobile
  // the bottom sheet covers it, so no push is needed. Mobile's `noteId` open still
  // renders the composer underneath the sheet unchanged.
  const pushedDown = !isMobile && !!noteId;

  // Opening a note slides the composer straight down out of the viewport. A bar
  // that is no longer on screen has no business still counting as focused — the
  // list's fade would stay deepened for a composer nobody can see.
  useEffect(() => {
    if (pushedDown) setFocused(false);
  }, [pushedDown]);

  return (
    <motion.div
      aria-hidden={pushedDown}
      initial={reduceMotion ? { opacity: 0 } : { y: 40, opacity: 0 }}
      animate={
        pushedDown
          ? reduceMotion
            ? { y: 0, opacity: 0 }
            : { y: "130%", opacity: 1 }
          : { y: 0, opacity: 1 }
      }
      // Matched to the note sheet's own motion so the two move as one: pushing DOWN
      // uses the note's OPEN curve (ease-out, 0.3s); sliding back UP uses the note's
      // CLOSE curve (ease-in, 0.26s — the same EASE_IN the panel shrinks with), so
      // the composer returns exactly as the note collapses into its card rather than
      // snapping back early.
      transition={
        pushedDown
          ? { type: "tween", duration: 0.3, ease: EASE_FOLLOW }
          : { type: "tween", duration: 0.26, ease: EASE_FOLLOW_REVERSED }
      }
      // `bottom` rides the keyboard inset (--kb, published by useKeyboardInset) so
      // an open software keyboard lifts the composer above it instead of burying it.
      // --kb is 0 on desktop / when closed, so this is a no-op there.
      style={{ bottom: "var(--kb, 0px)" }}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)_+_1rem)]"
    >
      <div
        ref={cardRef}
        onBlur={handleBlur}
        className={`surface-elevated composer-bar flex w-full max-w-2xl flex-col gap-2 p-2.5${pushedDown ? " pointer-events-none" : " pointer-events-auto"}${focused ? " is-focused" : ""}`}
      >
        <div className="flex items-center gap-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              // Enter creates the note; Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Jot down an idea…"
            // The vertical padding is derived from the min-height, not picked: a
            // textarea lays its first line out at the TOP of its box, so with
            // min-h-11 (44px) and py-1.5 (6px) a single line of 20px text sat 6px
            // from the top and 18px from the bottom — visibly high against the
            // Create button, which the row's `items-center` centres properly.
            // (44 − 20) / 2 = 12px = py-3 on phones, and (36 − 20) / 2 = 8px = py-2
            // at sm:, where the min-height drops to 36. autoGrow sizes from
            // scrollHeight, so it picks the new padding up on its own and multi-line
            // growth is unaffected.
            className="max-h-[40vh] min-h-11 flex-1 resize-none bg-transparent px-1 py-3 text-sm outline-none placeholder:text-muted-foreground sm:min-h-9 sm:py-2"
          />
          {expanded && (
            <Button size="sm" onClick={submit} disabled={create.isPending || !body.trim()} className="h-9 gap-1.5 px-4 sm:h-8 sm:px-3">
              Create <CornerDownLeft className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {expanded && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            {/* `sm:h-9 sm:text-sm` rather than `sm:h-8 sm:text-xs`, so the folder trigger is
                the same height as the tag chips and the Tags button beside it — those are
                h-9/text-sm, and FolderSelect's own default already is too. The old override
                made it 32px next to their 36px, which read as one control sitting slightly
                low in a row of three. Mobile keeps its taller h-10: a bigger touch target is
                worth more than pixel symmetry on a bar you thumb at. */}
            <FolderSelect value={folderId} onChange={setFolderId} className="h-10 text-sm sm:h-9 sm:text-sm" />
            <TagMultiSelect value={tagIds} onChange={setTagIds} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
