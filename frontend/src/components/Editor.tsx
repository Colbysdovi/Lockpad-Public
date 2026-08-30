import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Editor as TipTapEditor, EditorContent, BubbleMenu, type EditorOptions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import { TaskListWithChecked } from "./taskListView";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import DOMPurify from "dompurify";
import { SlashCommand } from "./slashCommand";
import { BlockDragHandle } from "./blockDragHandle";
import { SmartLink } from "./smartLink";
import { NoteLink } from "./noteLink";
import { Highlight } from "./highlight";
import { NoteImage, type ImageUploadResult } from "./imageNode";
import { matchProvider } from "@/lib/smartLinkProviders";

// One lowlight registry for the whole app (highlight.js "common" set — ~35
// popular languages, all bundled locally so there is NO external/CDN request,
// preserving the zero-outbound privacy guarantee). Auto-detects the language
// when a code block has none set.
const lowlight = createLowlight(common);
import {
  Ban, Bold, Italic, Strikethrough, Highlighter, Image as ImageIcon, Loader2, X, Heading1, Heading2, Heading3, List, ListOrdered, ListChecks, Quote, Code, SquareCode, Link2, Undo2, Redo2,
} from "@/components/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/lib/useIsMobile";
import { takeSessionEditor, parkSessionEditor, canonicalContent, bindLiveHandlers, liveHandlers, liveHandlersForDom, type LiveHandlers } from "@/lib/editorSession";
import { HIGHLIGHT_COLORS, asHighlightColor, highlightVar, type HighlightColor } from "@/lib/highlightColors";
import { ImageError, prepareImage, uploadNoteImage } from "@/lib/noteImages";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT, tOutsideReact } from "@/lib/i18n";

// TipTap rich-text editor (spec §3.3). Toolbar + selection bubble menu expose
// bold/italic/H1–H3/lists/quote/code/link. Paste is sanitized (spec §3.10 A):
// TipTap parses text/html, and we run it through DOMPurify first.

function ToolbarButton({ active, onClick, label, children, pill, disabled, pressed }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode; pill?: boolean; disabled?: boolean; pressed?: boolean }) {
  const btn = (
    <button
      type="button"
      aria-label={label}
      // Formatting buttons are toggles and report their on/off state; an action
      // button (undo) is not a toggle, so it must not claim to be one.
      aria-pressed={pressed === false ? undefined : active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "icon-press shrink-0 hover-scrim",
        // Both the persistent toolbar and the selection bubble use the SAME compact
        // rounded-md icon button (the app's shape) — the bubble is just a smaller
        // padded variant, not a pill, so it fits the rest of the UI.
        pill ? "rounded-md p-2" : "rounded-md p-2.5 sm:p-2",
        active && "bg-accent text-accent-foreground",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
    >
      {children}
    </button>
  );
  // Label the persistent toolbar buttons; the transient bubble-menu pills sit in
  // their own floating popover, so a second hovering label there would be noise.
  return pill ? btn : <Tooltip label={label}>{btn}</Tooltip>;
}

// A group divider for the toolbar (thin vertical rule between action groups).
function ToolbarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

// Link toolbar action: opens a popover with a single URL input over the current
// selection. Seeded with the selection's existing link (so it doubles as "edit"),
// and clearing the field + submitting removes the link. Submit is Enter; Escape or
// clicking away dismisses. Kept as its own component so the popover open-state and
// the seeded input value are local to it.
function LinkButton({ editor }: { editor: TipTapEditor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const active = editor.isActive("link");

  const apply = () => {
    const value = url.trim();
    // extendMarkRange keeps an edit applying to the whole existing link even when
    // the caret merely sits inside it (no explicit selection).
    if (value === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      // Default to https:// when no scheme is given, so "example.com" links out
      // instead of becoming a broken relative path.
      const href = /^[a-z][\w+.-]*:|^\/\//i.test(value) ? value : `https://${value}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setOpen(false);
  };

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={(next) => {
        // Seed the field from the current selection's link each time it opens.
        if (next) setUrl((editor.getAttributes("link").href as string) ?? "");
        setOpen(next);
      }}
      title={t("editor.link")}
      triggerLabel={t("editor.link.edit")}
      contentClassName="w-72"
      trigger={
        <button
          type="button"
          aria-label={t("editor.link")}
          aria-pressed={active}
          className={cn(
            "icon-press shrink-0 rounded-md p-2.5 hover-scrim sm:p-2",
            active && "bg-accent text-accent-foreground"
          )}
        >
          <Link2 className="h-[18px] w-[18px]" />
        </button>
      }
    >
      {/* type="text" (not "url") so native validation never blocks Enter before
          we get a chance to normalise the scheme. Enter is handled explicitly —
          a lone-input form's implicit submission is unreliable across browsers. */}
      <div className="p-2 max-sm:px-4 max-sm:pb-4 max-sm:pt-1">
        <Input
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("editor.link.placeholder")}
          aria-label={t("editor.link.url")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); apply(); }
            else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          }}
          className="max-sm:h-12 max-sm:text-base"
        />
      </div>
    </ResponsivePopover>
  );
}

// The highlighter's colour row — five swatches plus a "no highlight" eraser.
//
// Shared by the persistent toolbar (inside a popover) and the selection bubble
// (rendered in place of the pills), so the two surfaces can never drift apart.
//
// Every button suppresses mousedown. Without that, pressing a swatch moves focus
// out of the editor, which collapses the text selection — and the highlight would
// then land on nothing. Preventing the default keeps the selection exactly where
// the user made it, which is the whole point of a selection-based action.
function HighlightSwatches({ editor, onDone }: { editor: TipTapEditor; onDone?: () => void }) {
  const t = useT();
  const active = editor.isActive("highlight");
  const current = active ? asHighlightColor(editor.getAttributes("highlight").color) : null;

  const apply = (color: HighlightColor) => {
    editor.chain().focus().toggleHighlight({ color }).run();
    onDone?.();
  };

  return (
    <div className="flex items-center gap-1.5 p-1.5 max-sm:gap-2.5 max-sm:px-4 max-sm:pb-4 max-sm:pt-1">
      {HIGHLIGHT_COLORS.map((c) => (
        <Tooltip key={c.key} label={c.label}>
          <button
            type="button"
            aria-label={c.label}
            aria-pressed={current === c.key}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(c.key)}
            className={cn(
              "icon-press h-7 w-7 shrink-0 rounded-full border transition-transform max-sm:h-10 max-sm:w-10",
              // The chosen colour gets a ring rather than a checkmark: a tick drawn
              // over a pale wash is hard to see, and the ring reads at a glance.
              current === c.key ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : "border-border"
            )}
            style={{ background: highlightVar(c.key) }}
          />
        </Tooltip>
      ))}
      {/* Removing the highlight is part of the same control, not a separate menu —
          you reach for the highlighter to take one off just as often as to put one on. */}
      <Tooltip label={t("editor.highlight.remove")}>
        <button
          type="button"
          aria-label={t("editor.highlight.remove")}
          disabled={!active}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { editor.chain().focus().unsetHighlight().run(); onDone?.(); }}
          className={cn(
            "icon-press ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border",
            "text-muted-foreground hover-scrim disabled:pointer-events-none disabled:opacity-40 max-sm:h-10 max-sm:w-10"
          )}
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

// Highlight toolbar action: a swatch row in a popover. Kept separate from the
// bubble-menu path (which morphs in place) because the persistent toolbar has room
// for a real popover and no focus contest to lose.
function HighlightButton({ editor }: { editor: TipTapEditor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const active = editor.isActive("highlight");
  return (
    <ResponsivePopover
      open={open}
      onOpenChange={setOpen}
      title={t("editor.highlight")}
      triggerLabel={t("editor.highlight")}
      contentClassName="w-auto"
      trigger={
        <button
          type="button"
          aria-label={t("editor.highlight")}
          aria-pressed={active}
          className={cn(
            "icon-press shrink-0 rounded-md p-2.5 hover-scrim sm:p-2",
            active && "bg-accent text-accent-foreground"
          )}
        >
          <Highlighter className="h-[18px] w-[18px]" />
        </button>
      }
    >
      <HighlightSwatches editor={editor} onDone={() => setOpen(false)} />
    </ResponsivePopover>
  );
}

function Toolbar({ editor, canInsertImages }: { editor: TipTapEditor; canInsertImages: boolean }) {
  const t = useT();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // Edge-fade the horizontal-scroll strip toward whichever side still has buttons
  // out of view: a right fade at rest (more to the right), a left fade once scrolled,
  // both in the middle, none when it fits (desktop wraps, so it never overflows).
  const [fade, setFade] = useState({ left: false, right: false });
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [editor]);
  // Compose the mask from the two edges (24px taper). Undefined when nothing is
  // hidden, so the strip renders crisp with no fade at all.
  const maskImage = (() => {
    if (!fade.left && !fade.right) return undefined;
    const l = fade.left ? "transparent 0, #000 24px" : "#000 0";
    const r = fade.right ? "#000 calc(100% - 24px), transparent 100%" : "#000 100%";
    return `linear-gradient(to right, ${l}, ${r})`;
  })();
  // "Stuck" = the toolbar has scrolled up to its pinned line (directly beneath the
  // fixed title), where it snaps to the full-width fixed look. Detected with an
  // IntersectionObserver on a zero-height sentinel just above the toolbar: the
  // observer's top boundary is inset by the title height, so the sentinel stops
  // intersecting exactly when the toolbar reaches its pinned line. This is
  // event-driven — no per-scroll getBoundingClientRect / setState, so scrolling
  // stays smooth (no jank) and the CSS state-change transition isn't restarted
  // every frame (which is what previously froze it).
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const toolbar = toolbarRef.current;
    if (!sentinel || !toolbar) return;
    let root: HTMLElement | null = toolbar.parentElement;
    while (root && root !== document.body) {
      const oy = getComputedStyle(root).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      root = root.parentElement;
    }
    if (!root || root === document.body) return;
    const scrollRoot = root;
    const titleEl = toolbar.closest(".note-view")?.querySelector<HTMLElement>(".note-title-row") ?? null;
    let io: IntersectionObserver | null = null;
    const build = () => {
      io?.disconnect();
      // offsetHeight — the layout height, immune to the modal's open scale-transform.
      const titleH = titleEl ? titleEl.offsetHeight : 64;
      io = new IntersectionObserver(
        ([entry]) => setStuck(!entry.isIntersecting),
        { root: scrollRoot, rootMargin: `-${titleH}px 0px 0px 0px`, threshold: 0 },
      );
      io.observe(sentinel);
    };
    build();
    // Rebuild the boundary if the title height changes (e.g. a long title wraps).
    const ro = titleEl ? new ResizeObserver(build) : null;
    ro?.observe(titleEl!);
    return () => { io?.disconnect(); ro?.disconnect(); };
  }, [editor]);

  return (
    // A considered floating bar at rest (PRD 8); once it pins beneath the fixed
    // title it eases to a full-width bar with a bottom hairline (see index.css).
    // Buttons stay inset (aligned with the content) via the inner row's padding.
    <>
      {/* Zero-height marker just above the toolbar; the IntersectionObserver above
          watches it to toggle .note-toolbar-stuck exactly at the pinned line. */}
      <div ref={sentinelRef} aria-hidden className="h-0 shrink-0" />
      <div ref={toolbarRef} className={cn("note-toolbar", stuck && "note-toolbar-stuck")}>
        <div ref={innerRef} className="note-toolbar-inner no-scrollbar" style={{ WebkitMaskImage: maskImage, maskImage }}>
        {/* Undo and redo lead the toolbar, where every editor puts them. Without
            them the history was reachable only by keyboard — which is no way to
            find a feature, and on a phone is no way to USE one either: there is no
            Cmd+Z on a touch keyboard. Each is disabled at its own end of the
            history, so the pair also reports how far there is to go in either
            direction — and a press that could do nothing is never offered. */}
        <ToolbarButton
          label={t("editor.undo")}
          pressed={false}
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 className="h-[18px] w-[18px]" />
        </ToolbarButton>
        <ToolbarButton
          label={t("editor.redo")}
          pressed={false}
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 className="h-[18px] w-[18px]" />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton label={t("editor.bold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-[18px] w-[18px]" /></ToolbarButton>
        <ToolbarButton label={t("editor.italic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-[18px] w-[18px]" /></ToolbarButton>
        {/* Strikethrough was already in the document model (StarterKit ships it) but
            had no button, so the only way to reach it was typing ~~like this~~ from
            memory. It sits with bold and italic because that is what it is — a third
            inline emphasis — and it pairs with the app's checklists: crossing a line
            out is how a plan gets amended rather than erased. */}
        <ToolbarButton label={t("editor.strikethrough")} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-[18px] w-[18px]" /></ToolbarButton>
        <HighlightButton editor={editor} />
        <ToolbarDivider />
        <ToolbarButton label={t("editor.heading1")} active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-[18px] w-[18px]" /></ToolbarButton>
        <ToolbarButton label={t("editor.heading2")} active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-[18px] w-[18px]" /></ToolbarButton>
        <ToolbarButton label={t("editor.heading3")} active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-[18px] w-[18px]" /></ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton label={t("editor.bulletList")} active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-[18px] w-[18px]" /></ToolbarButton>
        <ToolbarButton label={t("editor.numberedList")} active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-[18px] w-[18px]" /></ToolbarButton>
        <ToolbarButton label={t("editor.checklist")} active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks className="h-[18px] w-[18px]" /></ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton label={t("editor.quote")} active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-[18px] w-[18px]" /></ToolbarButton>
        {/* SquareCode, not the bare Code brackets: the bubble menu now offers INLINE
            code with that glyph, and two actions that do different things must not
            look identical. The frame around these brackets is the block. */}
        <ToolbarButton label={t("editor.codeBlock")} active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><SquareCode className="h-[18px] w-[18px]" /></ToolbarButton>
        <ToolbarDivider />
        {/* Images are only offered once the note actually exists on the server —
            there is nowhere to upload to otherwise. That is why the quick composer
            (which has no note yet) shows no button rather than a broken one. */}
        {canInsertImages && (
          <ToolbarButton label={t("editor.insertImage")} pressed={false} onClick={() => editor.chain().focus().pickImage().run()}>
            <ImageIcon className="h-[18px] w-[18px]" />
          </ToolbarButton>
        )}
        <LinkButton editor={editor} />
        </div>
      </div>
    </>
  );
}

export function Editor({
  content,
  editable = true,
  onChange,
  onBlur,
  onLinkTrigger,
  collapseChecked = true,
  focusEndOnMount = false,
  sessionKey,
  noteId,
  noteLinkPick,
}: {
  content: unknown;
  editable?: boolean;
  onChange?: (doc: unknown) => void;
  onBlur?: () => void;
  onLinkTrigger?: () => void;
  // Keep-style: hide checked checklist items from the main flow and gather them
  // into a footer accordion. On by default (note editor); opt out for composers.
  collapseChecked?: boolean;
  // When true, drop the caret at the very end of the document once the editor is
  // ready — used when a note is opened straight from the quick-composer so the
  // user keeps typing where they left off.
  focusEndOnMount?: boolean;
  // Opt in to session-persistent undo: the editor is parked under this key when the
  // component unmounts and re-adopted the next time the same key mounts, so
  // Ctrl/Cmd+Z still reaches edits made before navigating away (lib/editorSession).
  // Omit it and the editor is destroyed on unmount, as before.
  sessionKey?: string;
  // The note these images belong to. Images are uploaded to a note, so a surface
  // without one (the quick composer) simply cannot take them — and says so by not
  // offering the action at all.
  noteId?: string;
  /** A note chosen from the [[ picker, to drop in as an inline chip. `seq` is what
   *  makes it fire: the same note can legitimately be linked twice in a row, so the
   *  trigger has to be a counter rather than the value changing. */
  noteLinkPick?: { seq: number; noteId: string; title: string };
}) {
  const t = useT();
  // The selection bubble menu is unreliable with touch text-selection; on phones
  // we rely on the (now larger, scrollable) toolbar instead.
  const isMobile = useIsMobile();
  // The selection bubble's Link action edits IN PLACE: clicking it swaps the bubble's
  // pills for a URL input rendered inside the same floating element (no nested popover
  // — a Radix popover anchored inside the ephemeral bubble fights over focus on close).
  // `linkOpenRef` mirrors `linkEditing` synchronously so the bubble's `shouldShow`
  // keeps it visible when focusing the input blurs the editor.
  const [linkEditing, setLinkEditing] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkOpenRef = useRef(false);
  // Highlight uses the SAME morph-in-place trick as Link rather than a nested
  // popover: the bubble is a transient element, and anchoring another floating
  // layer inside it means two overlays arguing about who closes first.
  const [bubbleHighlight, setBubbleHighlight] = useState(false);
  const bubbleInputRef = useRef<HTMLInputElement>(null);

  // Callbacks are reached through a registry keyed by the EDITOR, not captured in
  // its options and not read from a per-mount ref. A reused editor was configured on
  // some earlier mount, so anything baked into its options — or any ref object handed
  // out by that mount — still belongs to a component that may since have gone away.
  // See the note on bindLiveHandlers in lib/editorSession.ts for what that broke.
  //
  // This object's identity is stable for the life of the mount; its fields are
  // refreshed on every render, so the editor always calls today's props.
  const handlersRef = useRef<LiveHandlers>({});
  handlersRef.current.onChange = onChange;
  handlersRef.current.onBlur = onBlur;
  handlersRef.current.onLinkTrigger = onLinkTrigger;
  handlersRef.current.noteId = noteId;
  const contentRef = useRef(content);
  contentRef.current = content;

  // What the editor says while a picture is being added, and what it says when one
  // could not be. Deliberately a strip inside the editor rather than a toast: the
  // failure belongs to the thing being written, and a message that floats away in a
  // corner is the wrong place to explain why a photo did not appear.
  const [imageStatus, setImageStatus] = useState<{ kind: "busy" | "error"; message: string } | null>(null);
  // An error clears itself after long enough to read it, so the strip does not
  // become a permanent fixture of a note the user has moved on from.
  useEffect(() => {
    if (imageStatus?.kind !== "error") return;
    const timer = window.setTimeout(() => setImageStatus(null), 9000);
    return () => window.clearTimeout(timer);
  }, [imageStatus]);

  // Validate → shrink → upload. Returns the attributes for a new image node, or null
  // when it could not be done (having already explained why). Both error types are
  // written for a person: ImageError is ours, and ApiError carries the server's own
  // message, which is the one that knows the real size limit on this install.
  const uploadImage = useCallback(
    async (file: File): Promise<ImageUploadResult | null> => {
      if (!noteId) return null;
      try {
        setImageStatus({ kind: "busy", message: t("editor.image.adding") });
        const prepared = await prepareImage(file);
        const uploaded = await uploadNoteImage(noteId, prepared);
        setImageStatus(null);
        return { src: uploaded.src, alt: prepared.alt, width: uploaded.width, height: uploaded.height };
      } catch (error) {
        setImageStatus({
          kind: "error",
          message:
            error instanceof ImageError || error instanceof ApiError
              ? error.message
              : t("editor.image.failed"),
        });
        return null;
      }
    },
    [noteId]
  );

  const optionsRef = useRef<Partial<EditorOptions>>(undefined!);
  optionsRef.current = {
    editable,
    extensions: [
      // Disable StarterKit's plain codeBlock in favour of the lowlight-backed one
      // (syntax highlighting, PRD 8) — otherwise the two node types collide.
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }),
      // Links open on click in a new tab — handled explicitly in editorProps.handleClick
      // (not the extension's openOnClick, which passes no `noopener` and reads a target
      // that's empty on pre-existing links). HTMLAttributes still tag newly-made links
      // so native middle/cmd-click behave too.
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
      // The placeholder is read at extension-configure time, so it takes the module-level
      // translator rather than a hook — the editor is built inside a useMemo, outside any
      // render that could subscribe to the locale.
      Placeholder.configure({ placeholder: tOutsideReact("editor.placeholder") }),
      TaskListWithChecked.configure({ showCheckedFold: collapseChecked }),
      TaskItem.configure({ nested: true }),
      // Highlight is ours rather than @tiptap/extension-highlight so the colour is
      // stored by name and resolved per theme — see components/highlight.ts.
      Highlight,
      NoteImage,
      SlashCommand,
      BlockDragHandle,
      SmartLink,
      NoteLink,
    ],
    content: (content as object) ?? undefined,
    onUpdate: ({ editor }) => liveHandlers(editor)?.onChange?.(editor.getJSON()),
    onBlur: ({ editor }) => liveHandlers(editor)?.onBlur?.(),
    editorProps: {
      // Clicking a link opens it in a new tab (noopener/noreferrer) instead of
      // dropping the caret into it. Guarded to web/mail/tel schemes so a stray
      // javascript:/data: href can't be launched. Returning true marks the click
      // handled so ProseMirror doesn't also place the cursor inside the link.
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return false;
        if (/^(https?|mailto|tel):/i.test(a.href)) {
          window.open(a.href, "_blank", "noopener,noreferrer");
        }
        return true;
      },
      // Sanitize any pasted HTML before TipTap parses it (spec §3.10 A).
      transformPastedHTML: (html) => DOMPurify.sanitize(html),
      // Bare-URL paste → a smart-link block when the URL matches a recognized provider
      // (prd-smart-link-blocks.md). ONLY a paste that is solely one recognized URL
      // converts; anything else (prose, a URL mid-sentence, an unrecognized domain)
      // falls through to normal paste, unchanged. Pure string matching — nothing fetched.
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (!text || /\s/.test(text)) return false; // must be a single bare token
        const provider = matchProvider(text);
        if (!provider) return false;
        const type = view.state.schema.nodes.smartLink;
        if (!type) return false;
        view.dispatch(view.state.tr.replaceSelectionWith(type.create({ url: text, provider: provider.id })).scrollIntoView());
        return true;
      },
      // Detect the `[[` trigger to open the note-link picker (spec §3.5).
      handleTextInput: (view, from, _to, text) => {
        if (text === "[") {
          const before = view.state.doc.textBetween(Math.max(0, view.state.selection.from - 1), view.state.selection.from);
          if (before === "[") {
            const handlers = liveHandlersForDom(view.dom);
            // Remember WHERE the two brackets are, so picking a note can consume them
            // instead of leaving them stranded in the sentence. `from` is where this
            // second "[" is about to land, so the pair spans from one before it to one
            // after. Recorded here rather than derived later because by the time a note
            // is picked the selection has long since moved into the picker's own field.
            if (handlers) handlers.noteLinkRange = { from: from - 1, to: from + 1 };
            handlers?.onLinkTrigger?.();
          }
        }
        return false;
      },
    },
  };

  // Create the editor, or re-adopt the one parked under `sessionKey` — that is what
  // carries undo history across navigation. A layout effect (not a lazy useState
  // initializer) because the initializer runs twice under StrictMode and would leak
  // the first editor; an effect's cleanup pairs with its setup, so the double
  // invocation parks and re-takes the SAME instance. Running at layout time keeps
  // the extra render off-screen, so there is no empty frame before the text appears.
  const [editor, setEditor] = useState<TipTapEditor | null>(null);
  const [, bumpEditor] = useReducer((n: number) => n + 1, 0);
  const sourceRef = useRef("");

  useLayoutEffect(() => {
    const taken = sessionKey ? takeSessionEditor(sessionKey, contentRef.current) : null;
    let instance: TipTapEditor;
    if (taken) {
      instance = taken.editor;
      sourceRef.current = taken.source;
    } else {
      instance = new TipTapEditor(optionsRef.current);
      sourceRef.current = canonicalContent(contentRef.current);
    }
    setEditor(instance);
    // Claim the editor's callbacks for THIS mount. Without it a re-adopted editor
    // keeps reporting to the mount that built it — saves would still happen, silently,
    // while the save indicator on screen never moved. Bound here rather than in a
    // separate effect so it is in place before the first keystroke can arrive.
    const unbind = bindLiveHandlers(instance, handlersRef.current);
    // Re-render on every transaction so the toolbar's active/disabled states track
    // the selection — the same trade-off TipTap's own useEditor makes.
    instance.on("transaction", bumpEditor);
    return () => {
      unbind();
      instance.off("transaction", bumpEditor);
      if (sessionKey) parkSessionEditor(sessionKey, instance, sourceRef.current);
      else instance.destroy();
    };
    // Options are read from a ref on purpose: only a change of NOTE rebuilds the
    // editor. See the note below on why `content` must not drive a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  // NOTE: we deliberately do NOT sync the `content` prop back into the editor
  // after mount. `content` is only the *initial* document. While the user types,
  // autosave writes the note back to the query cache, which pushes a fresh
  // `content` prop down here — and re-applying it with `setContent` collapses the
  // ProseMirror selection to the document end (the "cursor jumps to the last
  // word" bug). The editor is the source of truth for its own content; when a
  // genuinely different document must load (switching notes, lock/unlock), the
  // parent remounts this component via its `key`, so the new content is picked up
  // as fresh initial content — no in-place setContent needed.
  // The `false` is load-bearing: it tells TipTap NOT to emit an `update` event.
  // setEditable fires one by default, carrying an EMPTY transaction — no steps, not
  // a single character changed. Our onUpdate feeds autosave, so that phantom update
  // turned simply OPENING a note into a save: the identical text written straight
  // back, `updatedAt` bumped, and the card jumping to the front of a list sorted by
  // most-recently-touched. Reading a note is not editing it, so the grid must not
  // reshuffle around whatever you happened to look at.
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editable, editor]);

  // Hand the current uploader to the editor. It goes into the extension's storage
  // rather than its options because a parked-and-re-adopted editor still carries the
  // options it was BUILT with — from a mount that has since gone away — whereas
  // storage can be written by whichever component is on screen now. Cleared on
  // unmount so a parked editor can never upload into a note nobody is looking at.
  useEffect(() => {
    if (!editor) return;
    editor.storage.image.upload = uploadImage;
    return () => {
      if (!editor.isDestroyed) editor.storage.image.upload = null;
    };
  }, [editor, uploadImage]);

  // Opened from the composer: place the caret at the end of the just-typed text so
  // the user keeps writing seamlessly. Deferred a frame so it runs after the sheet's
  // open animation has begun. Keyed on the editor INSTANCE (not a boolean ref) so it
  // fires once per real editor — and re-fires for the fresh instance React StrictMode
  // creates on its dev remount — while never re-focusing on an `editable` toggle.
  const focusedFor = useRef<TipTapEditor | null>(null);
  useEffect(() => {
    if (!editor || !editable || !focusEndOnMount || focusedFor.current === editor) return;
    focusedFor.current = editor;
    requestAnimationFrame(() => {
      if (!editor.isDestroyed) editor.commands.focus("end");
    });
  }, [editor, editable, focusEndOnMount]);

  // A note was picked in the [[ picker: swap the typed trigger for a chip.
  //
  // Keyed on `seq` so linking the same note twice in a row still fires. The two
  // brackets are only consumed if they are STILL exactly "[[" at the position we
  // recorded — the picker is a separate surface and the document may have moved on
  // underneath it, and deleting two characters of someone's prose on a stale
  // position is a far worse outcome than leaving a stray "[[" behind.
  const pickedSeq = useRef(0);
  useEffect(() => {
    if (!editor || !noteLinkPick || noteLinkPick.seq === pickedSeq.current) return;
    pickedSeq.current = noteLinkPick.seq;
    const handlers = liveHandlers(editor);
    const range = handlers?.noteLinkRange;
    let consume: { from: number; to: number } | undefined;
    if (range && range.to <= editor.state.doc.content.size) {
      try {
        if (editor.state.doc.textBetween(range.from, range.to) === "[[") consume = range;
      } catch {
        // The range no longer addresses anything in this document; leave the text be.
      }
    }
    if (handlers) handlers.noteLinkRange = undefined;
    editor.commands.insertNoteLink({ noteId: noteLinkPick.noteId, title: noteLinkPick.title }, consume);
  }, [editor, noteLinkPick]);

  // Focus (and select) the bubble's link input the moment it appears, so the user
  // can type — or overwrite an existing link — immediately after clicking Link.
  useEffect(() => {
    if (linkEditing) {
      bubbleInputRef.current?.focus();
      bubbleInputRef.current?.select();
    }
  }, [linkEditing]);

  if (!editor) return null;

  // Bubble link controls. `linkOpenRef` flips synchronously (before the input steals
  // focus) so the bubble's shouldShow keeps it visible across the editor blur.
  const startBubbleLink = () => {
    linkOpenRef.current = true;
    setLinkUrl((editor.getAttributes("link").href as string) ?? "");
    setLinkEditing(true);
  };
  const dismissBubbleLink = () => {
    linkOpenRef.current = false;
    setLinkEditing(false);
    setBubbleHighlight(false);
  };
  const applyBubbleLink = () => {
    const value = linkUrl.trim();
    if (value === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = /^[a-z][\w+.-]*:|^\/\//i.test(value) ? value : `https://${value}`;
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    dismissBubbleLink();
  };

  return (
    <div className={cn("flex flex-col gap-6", collapseChecked && "collapse-checked")}>
      {editable && <Toolbar editor={editor} canInsertImages={!!noteId} />}
      {/* Selection bubble: each action is a discrete pill (PRD 8), spaced apart
          rather than a flat undifferentiated row. Its actions are the ones that most
          benefit from sitting AT the selection — inline emphasis plus Link (inherently
          about the selected text) — rather than duplicating the fixed toolbar's
          block-level controls (headings/lists/quote/code live only there). Clicking
          Link morphs the bubble into a URL field in place; the bubble stays visible
          across the resulting editor blur via linkOpenRef + shouldShow. */}
      {editable && !isMobile && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100, onHidden: dismissBubbleLink }}
          shouldShow={({ editor, state }) => {
            // Keep the bubble up while editing a link, even though focusing its input
            // blurs the editor (which would otherwise hide it).
            if (linkOpenRef.current) return true;
            const { empty } = state.selection;
            return editor.isEditable && editor.isFocused && !empty;
          }}
          className="flex items-center gap-0.5 rounded-xl border bg-card p-1 shadow-md"
        >
          {bubbleHighlight ? (
            <HighlightSwatches editor={editor} onDone={() => setBubbleHighlight(false)} />
          ) : linkEditing ? (
            <input
              ref={bubbleInputRef}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("editor.link.placeholder")}
              aria-label={t("editor.link.url")}
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onBlur={dismissBubbleLink}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); applyBubbleLink(); }
                else if (e.key === "Escape") { e.preventDefault(); dismissBubbleLink(); editor.chain().focus().run(); }
              }}
              className="w-56 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          ) : (
            <>
              <ToolbarButton pill label={t("editor.bold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-[18px] w-[18px]" /></ToolbarButton>
              <ToolbarButton pill label={t("editor.italic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-[18px] w-[18px]" /></ToolbarButton>
              <ToolbarButton pill label={t("editor.strikethrough")} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-[18px] w-[18px]" /></ToolbarButton>
              {/* INLINE code lives only here, never in the persistent toolbar. It is a
                  property of selected words — like bold or a link — whereas the
                  toolbar's Code block turns the whole paragraph into a code block.
                  Putting the two side by side was the surest way to have people reach
                  for the wrong one. */}
              <ToolbarButton pill label={t("editor.inlineCode")} active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code className="h-[18px] w-[18px]" /></ToolbarButton>
              <ToolbarButton pill label={t("editor.highlight")} active={editor.isActive("highlight")} onClick={() => setBubbleHighlight(true)}><Highlighter className="h-[18px] w-[18px]" /></ToolbarButton>
              <ToolbarButton pill label={t("editor.link")} active={editor.isActive("link")} onClick={startBubbleLink}><Link2 className="h-[18px] w-[18px]" /></ToolbarButton>
            </>
          )}
        </BubbleMenu>
      )}
      {/* WHERE THIS SITS IS LOAD-BEARING, and the reason is not obvious: it must
          come AFTER the bubble menu in this list, never between the toolbar and it.
          Tippy moves the bubble's element out to document.body when it mounts, while
          React still believes that element is a child here. Anything rendered just
          BEFORE the bubble is therefore inserted relative to a node that has left the
          building — `insertBefore` throws NotFoundError and takes the whole note view
          down with it. Rendered here, the insertion reference is the editor's own
          div, which really is a child. (No layout consequence either way: the bubble
          occupies no space in this column.) */}
      {imageStatus && (
        <div
          role="status"
          className={cn(
            "-mb-2 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm",
            // Spelled with color-mix rather than `bg-destructive/5`: a palette colour
            // here is a var() holding a hex, and Tailwind cannot slice an alpha out of
            // one — it emits nothing at all. Until this was fixed the error state had
            // neither its border nor its tint, only red text, so a failed upload looked
            // almost identical to one in progress. Same trap as SecuritySettings.tsx.
            imageStatus.kind === "error"
              ? "border-[color-mix(in_srgb,var(--destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_5%,transparent)] text-destructive"
              : "bg-[color-mix(in_srgb,var(--muted)_40%,transparent)] text-muted-foreground"
          )}
        >
          {imageStatus.kind === "busy" && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          <span className="min-w-0 flex-1">{imageStatus.message}</span>
          {imageStatus.kind === "error" && (
            <button
              type="button"
              aria-label={t("editor.dismiss")}
              onClick={() => setImageStatus(null)}
              className="icon-press shrink-0 rounded-md p-1 hover-scrim"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
