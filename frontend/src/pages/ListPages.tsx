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
            <Tooltip key="back-to-top" label="Back to top">
            <motion.button
              type="button"
              onClick={() => listRef.current?.scrollToTop()}
              aria-label="Back to top"
              // Horizontal centering rides on framer's `x` (not a Tailwind translate),
              // since framer owns the `transform` property and would otherwise drop it.
              initial={reduceMotion ? { opacity: 0, x: "-50%" } : { opacity: 0, x: "-50%", y: 8, scale: 0.9 }}
              animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0, x: "-50%" } : { opacity: 0, x: "-50%", y: 8, scale: 0.9 }}
              transition={{ duration: 0.18, ease: EASE_FOLLOW }}
              whileHover={reduceMotion ? undefined : { scale: 1.06 }}
              whileTap={reduceMotion ? undefined : { scale: 0.94 }}
              // Sits just above the floating composer. On mobile the composer rests
              // collapsed (short), so the pill tucks in close (6rem); on desktop the
              // composer is always expanded (taller), so it clears that (9rem).
              className="surface-elevated absolute bottom-[calc(env(safe-area-inset-bottom)_+_6rem)] left-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border bg-card text-muted-foreground hover-scrim hover:text-foreground sm:bottom-[calc(env(safe-area-inset-bottom)_+_9rem)] sm:h-10 sm:w-10"
            >
              <ArrowUp className="h-5 w-5 sm:h-4 sm:w-4" />
            </motion.button>
            </Tooltip>
          )}
        </AnimatePresence>

        {count >= 2 ? <BulkActionBar /> : <NoteBar onFocusChange={setComposerFocused} />}
      </div>
    </div>
  );
}

export function HomePage() {
  return <ListScreen title="All notes" params={{ filter: "active" }} pinScope="all" />;
}

export function FolderPage() {
  const { id } = useParams<{ id: string }>();
  const folders = useFolders();
  const folder = findFolder(folders.data?.folders ?? [], id);
  return (
    <ListScreen
      title={folder ? folder.name : "Folder"}
      // Same folder mark as the sidebar, tinted with the folder's own colour.
      icon={folder ? <FolderIcon className="h-[1em] w-[1em] shrink-0" style={{ color: folder.color ?? undefined }} /> : undefined}
      params={{ filter: "active", folderId: id }}
      emptyLabel="No notes in this folder."
      archiveScope={id ? { folderId: id } : undefined}
      pinScope={id ? `folder:${id}` : undefined}
    />
  );
}

export function TagPage() {
  const { id } = useParams<{ id: string }>();
  const tags = useTags();
  const name = tags.data?.tags.find((t) => t.id === id)?.name;
  return (
    <ListScreen
      title={name ? `#${name}` : "Tag"}
      params={{ filter: "active", tagId: id }}
      emptyLabel="No notes with this tag."
      archiveScope={id ? { tagId: id } : undefined}
      pinScope={id ? `tag:${id}` : undefined}
    />
  );
}

export function ArchivePage() {
  const isMobile = useIsMobile();
  return (
    <FadingList
      params={{ filter: "archive" }}
      emptyLabel="Archive is empty."
      header={isMobile ? <ScrollTitle title="Archive" /> : undefined}
    />
  );
}

export function TrashPage() {
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
      toast(deleted === 1 ? "1 note permanently deleted" : `${deleted} notes permanently deleted`);
    } catch {
      toast("Could not empty the trash", { kind: "error" });
    } finally {
      setEmptying(false);
    }
  };

  // The title rides in the pinned header alongside "Empty trash" (same line), so it
  // does NOT also scroll inside the list — hence no ScrollTitle header here.
  return (
    <FadingList
      params={{ filter: "trash" }}
      emptyLabel="Trash is empty."
      pinnedHeader={
        <PageHeader
          title="Trash"
          right={
            <>
              <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)} disabled={emptying} className="gap-1.5">
                <Trash2 className="h-4 w-4" /> {emptying ? "Emptying…" : "Empty trash"}
              </Button>
              {/* This is the one action in the app with no undo — the notes are gone
                  from the database, not flagged — so it is also the one that must
                  actually ASK. It used to go through window.confirm, which browsers
                  suppress in several situations; a suppressed confirm returns false
                  rather than throwing, so the button silently did nothing at all. */}
              <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title="Empty the trash?"
                description="Every note in the trash will be permanently deleted. This is the one action that cannot be undone — notes elsewhere are not affected."
                confirmLabel={emptying ? "Deleting…" : "Delete permanently"}
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
