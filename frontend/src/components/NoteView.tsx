import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { X, Lock, Eye, Check, Loader2, MoreVertical, Archive, Copy, Trash2, ArchiveRestore, RotateCcw, XCircle, FileText, Printer, ChevronDown } from "@/components/icons";
import { Editor } from "@/components/Editor";
import { NoteMeta } from "@/components/NoteMeta";
import { LockButtons, LockMenuItems, LockDialog, type LockMode } from "@/components/LockPanel";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ResponsiveMenu, ResponsiveMenuItem, ResponsiveMenuSeparator } from "@/components/ui/responsive-menu";
import { exportNoteAsMarkdown, exportNoteAsPdf } from "@/lib/noteExport";
import { useNote, useNoteAction, useDuplicateNote, useLinkActions } from "@/lib/hooks";
import { useIsMobile } from "@/lib/useIsMobile";
import { useNoteSheet, getFocusBodyOnOpen } from "@/lib/useNoteSheet";
import { useToast } from "@/lib/useToast";
import { useAutoSave, type SaveState } from "@/lib/useAutoSave";
import { keyStore } from "@/lib/crypto";
import { useLockFx } from "@/lib/noteFx";
import { dropSessionEditor, canonicalContent } from "@/lib/editorSession";
import { LOCK_BLUR_MS, LOCK_REVEAL_MS, NOTE_CONTENT_SLIDE, NOTE_CONTENT_STILL } from "@/lib/motion";
import type { Note } from "@/lib/types";

/** Every note a body currently points at, read off the inline chips.
 *
 *  Walks the doc rather than using a ProseMirror descendant scan so it can run on
 *  plain JSON — the same shape that comes back from the server and goes into the
 *  autosave — without needing a live editor or a schema. */
function collectNoteLinkIds(doc: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; attrs?: { noteId?: unknown }; content?: unknown[] };
    if (n.type === "noteLink" && n.attrs?.noteId) out.add(String(n.attrs.noteId));
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out;
}
import { cn } from "@/lib/utils";
import { useT, useLocale, withSlots, SLOT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";

/** The bound translator, for the few helpers here that take it as an argument. */
type TranslateFn = (key: MessageKey) => string;

const saveLabels = (t: TranslateFn): Record<SaveState, string> => ({
  idle: "",
  unsaved: t("editor.status.unsaved"),
  saving: t("editor.status.saving"),
  saved: t("common.saved"),
  error: t("editor.status.error"),
});

// A locked note cannot be written to, so its save state is not a state at all —
// nothing is ever attempted. It used to surface as "Error saving", which reads as a
// fault when in fact everything is behaving correctly: the note is being viewed, not
// edited. Read-only gets its own indicator that says exactly that.


// Compact save-status affordance (PRD 3 / PRD 7): a small icon/dot instead of a
// persistent text label, so it doesn't compete with the note title. The label
// text still lives in an sr-only aria-live region for screen readers, and as the
// hover title. (Single implementation shared by both PRDs.)
function SaveIndicator({ state, compact, readOnly }: { state: SaveState; compact?: boolean; readOnly?: boolean }) {
  // `readOnly` means SESSION-UNLOCKED specifically, not merely locked — see the
  // `showStatus` note at the call site. While a note is viewed under its lock the
  // autosave's status is meaningless, and — because the server refuses the write —
  // actively misleading.
  const t = useT();
  // A locked note cannot be written to, so its save state is not a state at all —
  // nothing is ever attempted. It used to surface as "Error saving", which reads as a
  // fault when everything is behaving correctly: the note is being viewed, not
  // edited. Read-only OVERRIDES the save state rather than sitting alongside it.
  const label = readOnly ? t("editor.readOnly") : saveLabels(t)[state];
  return (
    // The full status ("Saving…", "Saved", …) shows on hover via the stylized
    // tooltip; it stays silent while idle (empty label → Tooltip renders nothing).
    // `compact` drops the 44px touch box for a tight inline badge (it's status, not
    // an action) — used on the mobile dates line.
    <Tooltip label={label} side="bottom">
      <span className={cn("flex shrink-0 items-center justify-center", compact ? "h-4 w-4" : "h-11 w-11 sm:h-9 sm:w-9")}>
        <span aria-hidden="true" className="flex items-center justify-center">
          {readOnly ? (
            // The same eye that opened the note — the reader's own action, echoed
            // back as the reason nothing is being saved. It can only appear once the
            // note has been opened for viewing, which is exactly when the header's
            // "View content" button has gone away, so the two eyes are never on
            // screen together.
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <>
              {/* "Editing (unsaved)" and "saving" share one spinner — the note is in
                  flight until it lands on the check. */}
              {(state === "saving" || state === "unsaved") && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              {state === "saved" && <Check className="h-3.5 w-3.5 text-success" />}
              {state === "error" && <span className="h-2 w-2 rounded-full bg-destructive" />}
            </>
          )}
        </span>
        <span className="sr-only" aria-live="polite">{label}</span>
      </span>
    </Tooltip>
  );
}

function formatStamp(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Compact stamp for the phone header so "Created … · Edited …" (plus the inline save
// check) is GUARANTEED to hold on a single line on any phone: a fixed-width numeric
// date, no time. The full desktop stamp keeps the date + time.
function formatStampMobile(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Lifecycle actions in the header (parity with the note card's action bar): a
// "More options" ⋮ menu holding the same Archive / Duplicate / Delete set the card
// exposes, chosen by the note's own status. Folder, tags, colour and lock already
// live inline in the header (NoteMeta + LockPanel), so only the lifecycle actions
// belong here. Destructive/bucket-changing actions close the sheet and surface an
// Undo toast — same wiring (hooks + toasts) the card uses, so behaviour matches.
function HeaderActions({ note, onBack, lockTrigger }: { note: Note; onBack: () => void; lockTrigger?: React.ReactNode }) {
  const t = useT();
  const actions = useNoteAction();
  const duplicate = useDuplicateNote();
  const toast = useToast();
  const { openNote } = useNoteSheet();

  const status = note.deletedAt ? "trash" : note.archivedAt ? "archive" : "active";

  const archive = () =>
    actions.archive.mutate(note.id, {
      onSuccess: () => {
        // `reverse` makes Undo rewind the card's archive animation once the note is
        // back in the list — the sheet is closed by then, so the card is the only
        // surface that can show the action being taken back.
        toast(t("note.archived"), {
          icon: <Archive className="h-4 w-4" />,
          action: { label: "Undo", onClick: () => actions.unarchive.mutate(note.id) },
          reverse: { ids: [note.id], kind: "archive" },
        });
        onBack();
      },
    });
  const del = () =>
    actions.del.mutate(note.id, {
      onSuccess: () => {
        toast(t("note.movedToTrash"), {
          icon: <Trash2 className="h-4 w-4" />,
          action: { label: "Undo", onClick: () => actions.restore.mutate(note.id) },
          reverse: { ids: [note.id], kind: "delete" },
        });
        onBack();
      },
    });
  // Duplicate swaps the open sheet to the fresh copy (same as opening it), so the
  // user lands on what they just created rather than being bounced to the list.
  const dupe = () => duplicate.mutate(note.id, { onSuccess: (copy) => openNote(copy.id) });
  const unarchive = () =>
    actions.unarchive.mutate(note.id, {
      onSuccess: () => { toast(t("noteView.unarchived")); onBack(); },
    });
  const restore = () =>
    actions.restore.mutate(note.id, {
      onSuccess: () => { toast(t("noteView.restored")); onBack(); },
    });
  const permanent = () =>
    actions.permanent.mutate(note.id, {
      onSuccess: () => { toast(t("noteView.deleted")); onBack(); },
    });

  return (
    <ResponsiveMenu
      // The drawer heading is the SOURCE note's title (with an icon chip) rather than
      // a generic "Note actions" — the background is blurred + dimmed behind the sheet,
      // so naming the note keeps the user anchored to what they're acting on.
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{note.title || t("note.untitled")}</span>
        </span>
      }
      triggerLabel={t("editor.moreActions")}
      trigger={
        <Button variant="ghost" size="icon" aria-label={t("editor.moreActions")} className="h-11 w-11 shrink-0 sm:h-9 sm:w-9">
          <MoreVertical className="h-5 w-5 sm:h-4 sm:w-4" />
        </Button>
      }
    >
      {/* Lock / unlock (mobile only — desktop keeps the inline lock button). */}
      {lockTrigger && (
        <>
          {lockTrigger}
          <ResponsiveMenuSeparator />
        </>
      )}
      {status === "active" && (
        <>
          <ResponsiveMenuItem onSelect={archive}><Archive className="mr-2 h-4 w-4" />{t("note.archive")}</ResponsiveMenuItem>
          <ResponsiveMenuItem onSelect={dupe} disabled={note.isLocked}><Copy className="mr-2 h-4 w-4" />{t("note.duplicate")}</ResponsiveMenuItem>
          <ResponsiveMenuItem onSelect={del} danger><Trash2 className="mr-2 h-4 w-4" />{t("common.delete")}</ResponsiveMenuItem>
        </>
      )}
      {status === "archive" && (
        <>
          <ResponsiveMenuItem onSelect={unarchive}><ArchiveRestore className="mr-2 h-4 w-4" />{t("note.unarchive")}</ResponsiveMenuItem>
          <ResponsiveMenuItem onSelect={del} danger><Trash2 className="mr-2 h-4 w-4" />{t("common.delete")}</ResponsiveMenuItem>
        </>
      )}
      {status === "trash" && (
        <>
          <ResponsiveMenuItem onSelect={restore}><RotateCcw className="mr-2 h-4 w-4" />{t("note.restore")}</ResponsiveMenuItem>
          <ResponsiveMenuItem onSelect={permanent} danger><XCircle className="mr-2 h-4 w-4" />{t("note.deletePermanently")}</ResponsiveMenuItem>
        </>
      )}

      {/* Export — available in every lifecycle state (you can export an archived
          or trashed note). Locked notes have no plaintext here, so the option is
          replaced by a hint to unlock first (never a silent no-op). */}
      <ResponsiveMenuSeparator />
      {note.isLocked ? (
        <ResponsiveMenuItem disabled>
          <Lock className="mr-2 h-4 w-4" />{t("note.export.locked")}
        </ResponsiveMenuItem>
      ) : (
        <>
          {/* Markdown export is asynchronous (it pulls the note's images into the
              file so it stands on its own); a failure is reported rather than
              leaving an unhandled rejection and no file. */}
          <ResponsiveMenuItem onSelect={() => { void exportNoteAsMarkdown(note).catch(() => toast(t("note.export.failed"), { kind: "error" })); }}>
            <FileText className="mr-2 h-4 w-4" />{t("note.export.markdown")}
          </ResponsiveMenuItem>
          <ResponsiveMenuItem onSelect={() => exportNoteAsPdf(note)}>
            <Printer className="mr-2 h-4 w-4" />{t("note.export.pdf")}
          </ResponsiveMenuItem>
        </>
      )}
    </ResponsiveMenu>
  );
}

// The note editor body. Rendered inside NoteSheet; `onBack` closes the sheet.
//
// The header's translucent, fading treatment (.note-frosted) is unconditional. It
// used to be a `frosted` prop that the mobile sheet set to false for a plain solid
// header, but the phone sheet grew its own frost and neither caller passed the prop
// any more — so it was always true, and the CSS branch for the other case could
// never match. Reduced transparency is handled in index.css by a media query, which
// is the case that actually needs a non-frosted look.
export function NoteView({ id, onBack, onStuckChange }: { id: string; onBack: () => void; onStuckChange?: (stuck: boolean) => void }) {
  const t = useT();
  const locale = useLocale();
  const { data: note, isLoading } = useNote(id);
  const autosave = useAutoSave(id);
  const reduceMotion = useReducedMotion();
  // The folder-derived accent strip down the panel's left edge used to be drawn
  // here, inside the note. It is drawn by NoteSheet instead (see NoteAccent there),
  // because it belongs to the PANEL rather than to whichever note is currently in
  // it: when you follow a link the contents slide across and the accent must stay
  // exactly where it is, which it cannot do while it is a child of the thing that
  // slides.
  // Captured once on mount (pure read — StrictMode-safe): true only when this note
  // was just opened from the quick-composer, so the editor drops the caret at the
  // end of the typed text.
  const [focusBody] = useState(getFocusBodyOnOpen);
  const [title, setTitle] = useState("");
  const [linkSignal, setLinkSignal] = useState(0);
  // A note chosen in the [[ picker, on its way to the editor as an inline chip.
  const [noteLinkPick, setNoteLinkPick] = useState<{ seq: number; noteId: string; title: string }>();
  const linkActions = useLinkActions();
  // Which notes the BODY currently points at, as of the last change we processed.
  // The chip and the link relationship are two views of one fact, so this is what
  // keeps them from drifting: whatever appears in the body gets a relationship,
  // whatever leaves it loses one. It is also what makes undo work properly — undoing
  // an insertion removes the chip, which removes the link, and redo puts both back.
  const bodyLinkIds = useRef<Set<string> | null>(null);
  // The last document we actually sent to be saved — the yardstick for "has anything
  // really changed?" used by the editor's onChange below.
  const lastQueuedDoc = useRef<{ noteId: string; canon: string } | null>(null);
  const [sessionDoc, setSessionDoc] = useState<unknown>(() => keyStore.get(id));
  // On phones the metadata editors (folder / colour / tags / links) collapse behind
  // a "Details" toggle so they don't push the note body off the first screen; desktop
  // always shows them. Opening the [[ link picker force-expands so it's visible.
  const isMobile = useIsMobile();
  const [metaOpen, setMetaOpen] = useState(false);
  useEffect(() => { if (linkSignal > 0) setMetaOpen(true); }, [linkSignal]);
  const showMeta = !isMobile || metaOpen;
  // Lock/unlock passphrase dialog mode. Owned here (not inside the trigger) so the
  // dialog survives the mobile "More options" menu closing when its item is picked.
  const [lockMode, setLockMode] = useState<LockMode>(null);
  // Phase of the "note is being sealed" animation. Above the loading early-return
  // (Rules of Hooks); `note` may not have loaded yet, hence the optional chaining.
  const lockFx = useLockFx(id, !!note?.isLocked);

  // Locking a note that is OPEN unmounts its editor, and the editor's own teardown
  // parks it for session undo — with the plaintext and every step needed to rebuild
  // it still inside. This runs after that teardown (a passive effect follows the
  // child's layout cleanup), so the parked editor is dropped again immediately.
  // Locking from a note CARD is covered separately, in LockPanel, since the note
  // view isn't mounted there.
  const locked = !!note?.isLocked;
  useEffect(() => {
    if (locked) dropSessionEditor(id);
  }, [locked, id]);

  // Sticky-title "stuck" detection: a 1px sentinel above the title row; when it
  // scrolls out of the scroll container the title is pinned, so we add .is-stuck
  // for a near-solid backing. IntersectionObserver (event-based, no per-frame
  // scroll handler) keeps this cheap.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const titleAreaRef = useRef<HTMLTextAreaElement>(null);
  // The panel is a labelled dialog we move focus into on open (a11y).
  const panelRef = useRef<HTMLDivElement>(null);
  const didFocusRef = useRef(false);
  const [stuck, setStuck] = useState(false);
  // Latest onStuckChange in a ref so the observer effect doesn't re-run when the
  // parent passes a fresh callback each render.
  const onStuckChangeRef = useRef(onStuckChange);
  onStuckChangeRef.current = onStuckChange;
  // Height of the pinned title row, published as --note-title-h so the toolbar
  // can stick directly beneath it (both stay fixed while the body scrolls).
  const [titleH, setTitleH] = useState(0);

  useEffect(() => {
    if (note) setTitle(note.title);
    setSessionDoc(keyStore.get(id));
  }, [note, id]);

  // Auto-grow the title textarea to fit its content so a long title WRAPS onto
  // as many lines as it needs instead of clipping (an <input> can't wrap). The
  // title row's ResizeObserver (below) picks up the height change and re-offsets
  // the sticky toolbar, so the whole title is always visible when a note opens.
  // Re-measure on `stuck` too: on mobile the title collapses to a smaller single
  // truncated line once pinned (see .note-title-row.is-stuck in index.css), so its
  // one-line scrollHeight must be re-read when that class toggles.
  useLayoutEffect(() => {
    const ta = titleAreaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
    // Publish the row height SYNCHRONOUSLY (same commit as a collapse/expand) so the
    // sticky toolbar's offset never lags the title — a lag opens a gap between the
    // pinned title and toolbar through which the scrolling content shows. offsetHeight
    // is the layout height, unaffected by the modal's mid-open scale-transform.
    const row = titleRef.current;
    if (row) setTitleH(row.offsetHeight);
  }, [title, stuck, isMobile]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    // Backstop for async height changes the layout effect can't see (open-scale
    // settle, late web-font swap): keep --note-title-h in sync with the row.
    const measure = () => setTitleH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, isLoading]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const io = new IntersectionObserver(([entry]) => {
      const s = !entry.isIntersecting;
      setStuck(s);
      // Let the mobile sheet's grab handle track the same solid backing the title
      // gets when pinned, so the two read as one continuous header cap.
      onStuckChangeRef.current?.(s);
    }, { root, threshold: 0 });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [id, isLoading]);

  // Move focus INTO the panel once it's open, so keyboard + screen-reader users
  // land here rather than on the list behind: the dialog's aria-label (the title)
  // is announced, and tabbing then flows title → header actions → metadata → body
  // in DOM order. Fires once per note. When the note was opened straight from the
  // composer we instead let the editor take focus at the end of the typed text
  // (focusEndOnMount), so we skip the panel focus in that case.
  useEffect(() => {
    if (didFocusRef.current || !note || focusBody) return;
    didFocusRef.current = true;
    // No cleanup-cancel here: React StrictMode's dev mount→cleanup→mount would
    // otherwise cancel the frame and, with the ref already set, never reschedule it
    // — so the panel would never get focus in dev. The focus is a no-op if the panel
    // has since unmounted (optional-chained ref).
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  }, [note, focusBody]);

  if (isLoading || !note) {
    return <div className="p-8 text-muted-foreground">{t("common.loading")}</div>;
  }

  const sessionUnlocked = locked && sessionDoc !== undefined;
  // Whether the header shows a save status at all.
  //
  // A locked note that has NOT been opened for viewing has no editor behind it and
  // nothing to save, so it has no status to report — showing one there put a
  // read-only eye directly beside the "View content" eye, two identical glyphs
  // meaning entirely different things (one a state, one a button). Once the note IS
  // open for viewing there is something to say — "you can read this, it will not
  // save" — and by then the button has gone, so the glyph is unambiguous again.
  const showStatus = !locked || sessionUnlocked;
  const editable = !locked;
  const editorContent = locked ? (sessionUnlocked ? sessionDoc : null) : note.content;

  // Bring the chip↔relationship diff to life against what the note ALREADY contains,
  // so the first edit of a session is compared with the note as it was loaded rather
  // than with an empty set — which would otherwise read every existing chip as newly
  // added and re-create every link on the first keystroke.
  if (bodyLinkIds.current === null && editorContent) bodyLinkIds.current = collectNoteLinkIds(editorContent);

  // The body is the source of truth for the links it shows. A chip that appears gets
  // a relationship; a chip that leaves loses one. Both directions matter: undo removes
  // a chip (so the link goes too), redo brings it back (so the link returns), and a
  // chip pasted from another note links this note to the same target. Duplicate chips
  // for one target collapse naturally — the set holds the id once, and the create
  // endpoint is idempotent besides.
  const syncBodyLinks = (doc: unknown) => {
    const next = collectNoteLinkIds(doc);
    const prev = bodyLinkIds.current;
    bodyLinkIds.current = next;
    if (!prev) return;
    for (const id of next) if (!prev.has(id)) linkActions.create.mutate({ noteId: note.id, targetNoteId: id });
    for (const id of prev) if (!next.has(id)) linkActions.remove.mutate({ noteId: note.id, targetId: id });
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      // The note's title names the dialog, so a screen reader announces it the
      // moment the panel receives focus on open.
      aria-label={note.title?.trim() || t("note.untitled")}
      tabIndex={-1}
      className="note-view note-frosted relative h-full outline-none"
      style={{ ["--note-title-h" as string]: titleH ? `${titleH}px` : undefined }}
    >
      {/* The scroll container is PANEL chrome, not note content — which is why the
          slide below starts inside it rather than around it. Its scroll bar sits at
          the panel's right edge and belongs to the frame the same way the folder
          accent belongs to the left edge: when you follow a link the words travel,
          and the bar those words are scrolled by stays exactly where it is, fading
          into the new one rather than riding off the edge with the old note.

          overflow-x-hidden because the content inside now translates sideways, and a
          vertical scroll container would otherwise turn that into horizontal
          scrolling. */}
      <div ref={scrollRef} className="flex h-full flex-col overflow-y-auto overflow-x-hidden overscroll-contain">
        {/* Everything the reader looks AT. It slides when the note changes, driven by
            the enter/center/exit labels NoteSheet sets on the layer above — Framer
            passes those down the tree, so there is no prop to thread and this renders
            perfectly still anywhere the labels are not being driven, which is every
            render except a note-to-note swap. min-h-full keeps the body zone's flex-1
            able to fill a short note, exactly as it did when these were direct children
            of the scroll container, and shrink-0 stops this wrapper being squeezed to
            the panel height by the flex column above it — without it the box would be
            shorter than the note inside it. */}
        <motion.div variants={reduceMotion ? NOTE_CONTENT_STILL : NOTE_CONTENT_SLIDE} className="flex min-h-full shrink-0 flex-col">
        {/* Sentinel for sticky-title "stuck" detection (see effect above). */}
        <div ref={sentinelRef} aria-hidden className="h-px shrink-0" />

        {/* Title row — a direct child of the sliding wrapper, which spans the whole
            note, so its sticky is bounded by the whole note rather than just the
            header: it stays pinned no matter how far down the user scrolls. Frosted (transparent over the
            panel tint) at rest; near-solid backing once pinned. */}
        <div ref={titleRef} className={cn("note-title-row shrink-0", stuck && "is-stuck")}>
          {/* When pinned on mobile the title collapses to one small line, so the icon
              buttons center on it (items-center) and the row padding tightens; at rest
              (multi-line) the buttons hug the first line (items-start). Desktop always
              uses the roomy items-start layout. */}
          <div
            className={cn(
              // transition-[padding] eases the vertical tightening as the title pins
              // (its background + the title cross-fade animate in step; see index.css).
              "mx-auto flex max-w-[800px] gap-2 px-5 transition-[padding] duration-200 ease-out sm:items-start sm:pb-3 sm:pl-16 sm:pr-8 sm:pt-8",
              stuck && isMobile ? "items-center pb-2 pt-2" : "items-start pb-3 pt-5"
            )}
          >
            {stuck && isMobile ? (
              // Pinned on mobile the title is a heading you've already read, so it
              // collapses to one line. A <textarea> can't render an ellipsis
              // (text-overflow doesn't apply to form controls), so swap in a plain
              // truncating element — matching how long card titles clip on the list.
              // Editing resumes when you scroll back up and the textarea returns.
              <div
                className={cn(
                  "type-title min-w-0 flex-1 truncate py-1 leading-tight",
                  !title && "text-muted-foreground"
                )}
              >
                {title || t("note.untitled")}
              </div>
            ) : (
              <textarea
                ref={titleAreaRef}
                value={title}
                onChange={(e) => { setTitle(e.target.value); autosave.queue({ title: e.target.value }); }}
                onBlur={() => autosave.flush()}
                // Enter in a title shouldn't insert a newline — commit and move on.
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                placeholder={t("note.untitled")}
                rows={1}
                className="type-title min-w-0 flex-1 resize-none overflow-hidden break-words bg-transparent py-1 leading-tight outline-none placeholder:text-muted-foreground"
                disabled={locked && !sessionUnlocked}
              />
            )}
            {/* Actions stay top-right (items-start) so a wrapped title flows below
                the first line without pushing them down. On mobile the title row is
                deliberately kept to just the two essentials — More options + Close —
                so the note title gets the width to read as the page title it is; the
                save status + lock control move to their own line below the dates. */}
            {!isMobile && showStatus && <SaveIndicator state={autosave.state} readOnly={sessionUnlocked} />}
            {!isMobile && <LockButtons note={note} sessionUnlocked={sessionUnlocked} onOpen={setLockMode} />}
            {/* Lifecycle actions (Archive / Duplicate / Delete …), parity with the card.
                On mobile the lock action rides inside this "More options" menu. */}
            <HeaderActions
              note={note}
              onBack={onBack}
              lockTrigger={isMobile ? <LockMenuItems note={note} sessionUnlocked={sessionUnlocked} onOpen={setLockMode} /> : undefined}
            />
            {/* Close the note (on the right). */}
            <Tooltip label={t("common.close")} side="bottom">
              <Button variant="ghost" size="icon" onClick={onBack} aria-label={t("common.close")} className="h-11 w-11 shrink-0 sm:h-9 sm:w-9">
                <X className="h-5 w-5 sm:h-4 sm:w-4" />
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* Metadata — NOT pinned; scrolls up and away beneath the fixed title.
            Also frosted (transparent over the panel tint). */}
        <div className="note-header-meta shrink-0">
          <div className="mx-auto flex max-w-[800px] flex-col gap-3 px-5 pb-1 sm:gap-5 sm:pb-3 sm:pl-16 sm:pr-8">
            {/* Timestamps: created + last edited (spec). On mobile a compact numeric
                format keeps the row on one line, and the save-status check rides at
                the end of it (it's status, not an action). */}
            <div className={cn("type-meta flex items-center gap-x-2.5 gap-y-0.5", isMobile ? "flex-nowrap whitespace-nowrap" : "flex-wrap")}>
              <span>{t("noteView.created", { when: (isMobile ? formatStampMobile : formatStamp)(note.createdAt, locale) })}</span>
              <span aria-hidden className="text-[color-mix(in_srgb,var(--muted-foreground)_50%,transparent)]">·</span>
              <span>{t("noteView.edited", { when: (isMobile ? formatStampMobile : formatStamp)(note.updatedAt, locale) })}</span>
              {/* Center the save check in a Close-button-width column so it lines up
                  directly under the ✕ in the header, not flush to the text edge. */}
              {isMobile && showStatus && <span className="ml-auto flex w-11 shrink-0 justify-center"><SaveIndicator state={autosave.state} compact readOnly={sessionUnlocked} /></span>}
            </div>

            {/* Mobile: the Details toggle on its OWN full-width line (the lock control
                now lives in the "More options" menu, so it no longer needs a row). */}
            {isMobile && (
              <button
                type="button"
                onClick={() => setMetaOpen((v) => !v)}
                aria-expanded={metaOpen}
                // Full width for a generous touch target, but the chevron hugs the
                // label (gap, not justify-between) so the control still reads as a
                // compact "Details ⌄" rather than a stretched, disconnected row. The
                // chevron points DOWN when closed (there's more below to reveal) and
                // flips UP when open.
                className="flex w-full items-center gap-1 rounded-md px-2 py-3 text-xs font-medium text-muted-foreground hover-scrim hover:text-foreground"
              >
                <span>{t("editor.details")}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", metaOpen && "rotate-180")} />
              </button>
            )}

            {showMeta && (
              <NoteMeta
                note={note}
                openLinkSignal={linkSignal}
                onPicked={(target, viaTrigger) => {
                  if (viaTrigger) setNoteLinkPick((p) => ({ seq: (p?.seq ?? 0) + 1, noteId: target.id, title: target.title }));
                }}
              />
            )}
          </div>
        </div>

        {/* Body / writing zone — the solid surface the frosted header fades into.
            The toolbar + editor always sit below the fade, on solid card. */}
        <div className="note-body-zone flex-1">
          <div className="mx-auto max-w-[800px] px-5 pb-[calc(env(safe-area-inset-bottom)_+_1.5rem)] sm:pl-16 sm:pr-8">
            {/* Why the note looks editable but isn't. This sat as a footnote BELOW the
                content, which is the one place a reader reaches only after trying to
                type — so it announced itself before the text instead, at the size of
                something you are meant to read. */}
            {sessionUnlocked && (
              <div className="mb-5 flex items-start gap-2.5 rounded-lg border bg-[color-mix(in_srgb,var(--muted)_40%,transparent)] px-3.5 py-3">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {/* Two nodes in one sentence, so it is split twice: the lead term and
                      the named action both keep their emphasis, and both stay where the
                      language puts them rather than where English did. */}
                  {withSlots(
                    t("noteView.readOnly.body", { term: SLOT, action: SLOT }),
                    <span className="font-medium text-foreground">{t("noteView.readOnly.term")}</span>,
                    <span className="font-medium text-foreground">{t("lock.remove")}</span>
                  )}
                </p>
              </div>
            )}
            {locked && !sessionUnlocked ? (
              <div
                className={cn(
                  "flex flex-col items-center gap-2 py-16 text-center text-muted-foreground",
                  lockFx === "revealing" && "lock-reveal"
                )}
                style={{ ["--lock-reveal-ms" as string]: `${LOCK_REVEAL_MS}ms` }}
              >
                <Lock className="h-8 w-8" />
                <p>{t("noteView.lockedBody")}</p>
              </div>
            ) : (
              // The wrapper exists purely to carry the blur: `filter` has to apply to
              // the whole writing zone (toolbar included) as one surface, or the parts
              // would fade out of focus independently.
              <div
                className={cn(lockFx === "blurring" && "note-locking")}
                style={{ ["--lock-blur-ms" as string]: `${LOCK_BLUR_MS}ms` }}
              >
                <Editor
                  key={`${note.id}-${sessionUnlocked ? "session" : "plain"}`}
                  // Undo history survives leaving and reopening this note (see
                  // lib/editorSession). Only for an editable note: a session-unlocked
                  // one is read-only, so it has no history to keep, and parking it
                  // would leave the decrypted document in memory after it closes.
                  sessionKey={editable ? note.id : undefined}
                  // Which note a pasted or dropped picture is uploaded to. Only for
                  // an editable note: a locked one being viewed for the session must
                  // not take new images, since they could not be encrypted with it.
                  noteId={editable ? note.id : undefined}
                  content={editorContent}
                  editable={editable}
                  focusEndOnMount={focusBody}
                  // Save only what genuinely differs. An editor can report an
                  // "update" that carries no edit at all (TipTap does exactly that
                  // when its editable flag is set), and writing that back would
                  // bump `updatedAt` — the field the note list sorts by — so
                  // merely reading a note would rearrange the grid. Compared by
                  // VALUE, not by string: the content round-trips through Postgres
                  // `jsonb`, which does not preserve key order, so the same
                  // document can come back spelled differently. The yardstick is
                  // the last doc we QUEUED (not the one first loaded), so typing a
                  // character and deleting it still saves the way back to where it
                  // started.
                  onChange={(doc) => {
                    syncBodyLinks(doc);
                    const canon = canonicalContent(doc);
                    const base =
                      lastQueuedDoc.current?.noteId === note.id
                        ? lastQueuedDoc.current.canon
                        : canonicalContent(editorContent);
                    if (canon === base) return;
                    lastQueuedDoc.current = { noteId: note.id, canon };
                    autosave.queue({ content: doc });
                  }}
                  onBlur={() => autosave.flush()}
                  onLinkTrigger={() => setLinkSignal((n) => n + 1)}
                  noteLinkPick={noteLinkPick}
                />
              </div>
            )}

          </div>
        </div>
        </motion.div>
      </div>

      {/* Lock/unlock passphrase dialog — rendered at the panel top level (not inside a
          trigger) so it survives the mobile "More options" menu closing on select. */}
      <LockDialog note={note} mode={lockMode} onModeChange={setLockMode} onSessionUnlock={(doc) => setSessionDoc(doc)} />
    </div>
  );
}
