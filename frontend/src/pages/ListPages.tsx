import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Trash2, Folder as FolderIcon } from "@/components/icons";
import { NoteList, type NoteListHandle } from "@/components/NoteList";
import { NoteBar } from "@/components/NoteBar";
import { BulkActionBar } from "@/components/BulkActionBar";
import { ArchivedSection } from "@/components/ArchivedSection";
import { PinnedSection, UnpinnedHeading } from "@/components/PinnedSection";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useFolders, useTags } from "@/lib/hooks";
import { SelectionProvider, useSelection } from "@/lib/useSelection";
import { useNoteSheet } from "@/lib/useNoteSheet";
import { useToast } from "@/lib/useToast";
import { useIsMobile } from "@/lib/useIsMobile";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Folder } from "@/lib/types";
import { EASE_FOLLOW } from "@/lib/motion";
import { useT } from "@/lib/i18n";

// The page title duplicates the sidebar's active item, so it earns its place
// only where the sidebar isn't showing it: on mobile (drawer hidden) or when the
// desktop sidebar is collapsed. When there's no title to show and no right-side
// action, the whole header row is dropped so the notes reclaim the space.
// A pinned action bar for pages that carry a page-level action (Trash's "Empty
// trash"). When a page has such an action, its TITLE rides on the SAME line as the
// action (mobile only) rather than scrolling inside the list — stacking a title and
// its call-to-action on separate rows wastes the small viewport and reads as broken.
// On desktop the title is hidden (the sidebar + URL are the location cue) and the
// action sits alone at the right, as before.
function PageHeader({ title, right }: { title?: string; right?: React.ReactNode }) {
  if (!right && !title) return null;
  return (
    // No rule underneath: Trash is the only page with a pinned header, and a divider
    // here made it the only screen in the app that draws one — the list's own top
    // fade already separates the header from the notes.
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      {title && <h1 className="type-section truncate sm:hidden">{title}</h1>}
      {right && <div className="flex shrink-0 items-center gap-2 sm:ml-auto">{right}</div>}
    </div>
  );
}

// Minimal list scaffold for the composer-less pages (Archive / Trash): the same
// top/bottom canvas fades as the home list, so notes appear to dissolve into the
// page as they scroll. The bottom fade is always on; the top fade reveals only once
// the list has scrolled. An optional `pinnedHeader` (Trash's action row) sits above.
function FadingList({
  params,
  emptyLabel,
  header,
  pinnedHeader,
}: {
  params: Parameters<typeof NoteList>[0]["params"];
  emptyLabel?: string;
  header?: React.ReactNode;
  pinnedHeader?: React.ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <div className="flex h-full flex-col">
      {pinnedHeader}
      <div className="relative flex-1 overflow-hidden py-4">
        <div aria-hidden className={cn("list-fade-top", scrolled && "is-visible")} />
        <NoteList params={params} emptyLabel={emptyLabel} header={header} onScrolled={setScrolled} />
        <div aria-hidden className="list-fade-bottom" />
      </div>
    </div>
  );
}

// The page title, rendered INSIDE the note list's scroll on mobile so it scrolls
// away as soon as the user starts browsing — it only needs to orient them on
// arrival, and otherwise eats a chunk of the small viewport. Mobile-only; desktop
// uses the sidebar/URL as the location cue.
function ScrollTitle({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return (
    <h1 className="type-section mb-5 flex items-center gap-2">
      {icon}
      <span className="truncate">{title}</span>
    </h1>
  );
}

// Shared list-view scaffold with view toggle + floating create bar. When
// `archiveScope` is set (folder/tag pages), a contextual "Archived" section is
// hung below the active notes, inside the same scroll.
interface ListScreenProps {
  title: string;
  // Optional leading icon for the mobile scroll title (e.g. the folder mark).
  icon?: React.ReactNode;
  params: Parameters<typeof NoteList>[0]["params"];
  emptyLabel?: string;
  archiveScope?: { folderId: string } | { tagId: string };
  // Per-page pin scope ("all" | "folder:<id>" | "tag:<id>"). When set, a Pinned
  // section is hung above the list and each card gets a pin toggle.
  pinScope?: string;
}

// Selection state is per-page: keying the provider on the params resets it when
// navigating between pages (or between folders/tags).
function ListScreen(props: ListScreenProps) {
  return (
    <SelectionProvider key={JSON.stringify(props.params)}>
      <ListScreenBody {...props} />
    </SelectionProvider>
  );
}

function ListScreenBody({ title, icon, params, emptyLabel, archiveScope, pinScope }: ListScreenProps) {
  const t = useT();
  // At 2+ selected the bulk bar replaces the composer in the same slot.
  const { count } = useSelection();
  const { noteId } = useNoteSheet();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  // Whether the list has scrolled from the top — drives the top-of-list fade.
  const [scrolled, setScrolled] = useState(false);
  // Whether the first notes have scrolled out of view — reveals "Back to top".
  const [deep, setDeep] = useState(false);
  // Mirrors the composer's own focused state (reported up by NoteBar, which owns it)
  // so the bottom fade can deepen at the same moment the bar lifts. Only this page
  // scaffold does it — FadingList (Archive/Trash) shares the same fade class but has
  // no composer to key off, and is left exactly as it was.
  const [composerFocused, setComposerFocused] = useState(false);
  const listRef = useRef<NoteListHandle>(null);

  // Hide the button while a note is open (the list is behind the sheet) or during
  // multi-select (the bulk bar owns the slot) — it only makes sense over the list.
  const showBackToTop = deep && !noteId && count < 2;
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 overflow-hidden py-4">
        {/* Fade notes into the canvas as they scroll UP under the top bar. Hidden
            until the list scrolls (see .list-fade-top). */}
        <div aria-hidden className={cn("list-fade-top", scrolled && "is-visible")} />
        <NoteList
          ref={listRef}
          params={pinScope ? { ...params, scope: pinScope } : params}
          scope={pinScope}
          emptyLabel={emptyLabel}
          // On mobile the page title rides at the top of the scroll so it scrolls
          // away with the content; the Pinned section (if any) follows it.
          header={
            isMobile || pinScope ? (
              <>
                {isMobile && <ScrollTitle title={title} icon={icon} />}
                {pinScope && (
                  <>
                    <PinnedSection scope={pinScope} />
                    <UnpinnedHeading scope={pinScope} />
                  </>
                )}
              </>
            ) : undefined
          }
          footer={archiveScope ? <ArchivedSection scope={archiveScope} /> : undefined}
          onScrolled={setScrolled}
          onDeepScroll={setDeep}
        />
        {/* Fade the last notes into the canvas as they scroll under the composer
            (above the cards, below the composer — see .list-fade-bottom). The fade
            deepens while the composer has focus, so the cards nearest it give up
            some weight to whatever is being written. Still pointer-events:none in
            every state: the list stays fully scrollable and clickable throughout. */}
        <div aria-hidden className={cn("list-fade-bottom", composerFocused && "is-composer-focused")} />

        {/* Back to top — a floating pill centered above the composer, revealed once
            the first notes leave the viewport. Sits just below the composer's z-layer
            so the two never fight for the same pixels. */}
        <AnimatePresence>
          {showBackToTop && (
            <Tooltip key="back-to-top" label={t("list.backToTop")}>
            <motion.button
              type="button"
              onClick={() => listRef.current?.scrollToTop()}
              aria-label={t("list.backToTop")}
              // Horizontal centering rides on framer's `x` (not a Tailwind translate),
              // since framer owns the `transform` property and would otherwise drop it.
              initial={reduceMotion ? { opacity: 0, x: "-50%" } : { opacity: 0, x: "-50%", y: 8, scale: 0.9 }}
              animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0, x: "-50%" } : { opacity: 0, x: "-50%", y: 8, scale: 0.9 }}
              transition={{ duration: 0.18, ease: EASE_FOLLOW }}
              whileHover={reduceMotion ? undefined : { scale: 1.06 }}
              whileTap={reduceMotion ? undefined : { scale: 0.94 }}
              // Position and size both come from the shared bottom-slot tokens, and
              // that sharing is the point rather than tidiness: the list's bottom
              // padding is derived from these same two values, so the button cannot be
              // moved or resized without the list clearing the new shape too. When
              // these were literals here and the padding was a literal in NoteList,
              // nothing connected them and the button ended up parked on top of "End
              // of list". Breakpoints live with the tokens in index.css.
              style={{
                bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-slot-clearance))",
                height: "var(--back-to-top-size)",
                width: "var(--back-to-top-size)",
              }}
              className="surface-elevated absolute left-1/2 z-20 flex items-center justify-center rounded-full border bg-card text-muted-foreground hover-scrim hover:text-foreground"
            >
              <ArrowUp className="h-5 w-5 sm:h-4 sm:w-4" />
            </motion.button>
            </Tooltip>
          )}
        </AnimatePresence>

        {/* The bottom slot, and the two bars that share it.

            Both are rendered, not one or the other. The composer STAYS MOUNTED and
            slides out of the viewport while the bulk bar has the slot — it was
            previously swapped out of the tree entirely, which made the handover a
            cut: one bar vanished mid-frame and another appeared in its place, with
            no sense that the slot had been passed from one to the other. Keeping it
            mounted also means a half-typed thought survives ticking a couple of
            cards, which the old swap quietly threw away.

            The bulk bar is still conditional, because it has nothing to say at zero
            or one selected. <AnimatePresence> is what lets it finish leaving before
            it goes: without it, unticking a note unmounts it on the spot and the
            composer rises into a slot the bar never visibly left. */}
        <NoteBar onFocusChange={setComposerFocused} yielded={count >= 2} />
        <AnimatePresence>{count >= 2 && <BulkActionBar />}</AnimatePresence>
      </div>
    </div>
  );
}

export function HomePage() {
  const t = useT();
  return <ListScreen title={t("nav.allNotes")} params={{ filter: "active" }} pinScope="all" />;
}

export function FolderPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const folders = useFolders();
  const folder = findFolder(folders.data?.folders ?? [], id);
  return (
    <ListScreen
      title={folder ? folder.name : t("list.title.folderFallback")}
      // Same folder mark as the sidebar, tinted with the folder's own colour.
      icon={folder ? <FolderIcon className="h-[1em] w-[1em] shrink-0" style={{ color: folder.color ?? undefined }} /> : undefined}
      params={{ filter: "active", folderId: id }}
      emptyLabel={t("list.empty.folder")}
      archiveScope={id ? { folderId: id } : undefined}
      pinScope={id ? `folder:${id}` : undefined}
    />
  );
}

export function TagPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const tags = useTags();
  const name = tags.data?.tags.find((t) => t.id === id)?.name;
  return (
    <ListScreen
      title={name ? `#${name}` : "Tag"}
      params={{ filter: "active", tagId: id }}
      emptyLabel={t("list.empty.tag")}
      archiveScope={id ? { tagId: id } : undefined}
      pinScope={id ? `tag:${id}` : undefined}
    />
  );
}

export function ArchivePage() {
  const t = useT();
  const isMobile = useIsMobile();
  return (
    <FadingList
      params={{ filter: "archive" }}
      emptyLabel={t("list.empty.archive")}
      header={isMobile ? <ScrollTitle title={t("nav.archive")} /> : undefined}
    />
  );
}

export function TrashPage() {
  const t = useT();
  const qc = useQueryClient();
  const [emptying, setEmptying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const toast = useToast();

  const emptyTrash = async () => {
    setEmptying(true);
    try {
      const { deleted } = await api.del<{ deleted: number }>("/notes/trash/empty");
      qc.invalidateQueries({ queryKey: ["notes"] });
      setConfirmOpen(false);
      toast(t("list.emptyTrash.done", { count: deleted }));
    } catch {
      toast(t("list.emptyTrash.failed"), { kind: "error" });
    } finally {
      setEmptying(false);
    }
  };

  // The title rides in the pinned header alongside "Empty trash" (same line), so it
  // does NOT also scroll inside the list — hence no ScrollTitle header here.
  return (
    <FadingList
      params={{ filter: "trash" }}
      emptyLabel={t("list.empty.trash")}
      pinnedHeader={
        <PageHeader
          title={t("nav.trash")}
          right={
            <>
              <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)} disabled={emptying} className="gap-1.5">
                <Trash2 className="h-4 w-4" /> {emptying ? t("trash.emptying") : t("trash.emptyButton")}
              </Button>
              {/* This is the one action in the app with no undo — the notes are gone
                  from the database, not flagged — so it is also the one that must
                  actually ASK. It used to go through window.confirm, which browsers
                  suppress in several situations; a suppressed confirm returns false
                  rather than throwing, so the button silently did nothing at all. */}
              <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={t("list.emptyTrash.title")}
                description={t("trash.empty.body")}
                confirmLabel={emptying ? t("list.emptyTrash.deleting") : t("list.emptyTrash.confirm")}
                destructive
                pending={emptying}
                onConfirm={emptyTrash}
              />
            </>
          }
        />
      }
    />
  );
}

function findFolder(folders: Folder[], id?: string): Folder | undefined {
  if (!id) return undefined;
  for (const f of folders) {
    if (f.id === id) return f;
    const child = findFolder(f.children, id);
    if (child) return child;
  }
  return undefined;
}
