import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronRight, ChevronDown, Folder as FolderIcon, Hash, Plus, Pencil, Home, Archive, Trash2, Check, Settings2 } from "@/components/icons";
import { useFolders, useTags, useCreateFolder, useUpdateFolder, useDeleteFolder, useCreateTag } from "@/lib/hooks";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Folder, Tag } from "@/lib/types";
import { cn } from "@/lib/utils";

// The navigation rail: every way of getting somewhere in the library.
//
// Four kinds of destination, in one column:
//   - the fixed pages — All notes, Archive, Trash, Settings
//   - the FOLDER tree, nested to any depth, each folder expandable and editable
//     in place (rename + recolour) without leaving the sidebar
//   - the TAG list, split into "frequently used" and the rest once it is long
//     enough to be worth splitting
//   - the create affordances for new folders and new tags
//
// It renders in two places and this component serves both: a floating column on
// desktop, and a slide-in drawer on phones (Layout decides which, and only one is
// mounted at a time). That is why `max-sm:` utilities appear throughout — they only
// ever apply to the drawer, where every row needs to be a comfortable touch target.
// `onNavigate` is how the drawer closes itself after a destination is chosen.
//
// A folder's COLOUR set here is not decoration: it becomes the accent stripe on
// every note filed inside it, and on notes in its sub-folders that have no colour of
// their own (see lib/folderColor.ts).

// One shared row style for EVERY sidebar destination — pages (All notes / Archive /
// Trash), folders, and tags — so their hover/active container is always the same
// size. Keeping it here (not re-declared per component) stops the paddings drifting.
// The mobile drawer (the only place this renders below 640px — desktop uses the
// floating sidebar, which is unmounted there) gets larger type, padding and gaps
// so every row is a comfortable touch target; `max-sm:` utilities apply only there.
const NAV_ITEM = "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover-scrim max-sm:gap-3 max-sm:rounded-lg max-sm:px-3 max-sm:py-3 max-sm:text-base";

// A single tag row: name + a right-aligned usage count (the count doubles as the
// frequency cue that drives the grouping below).
function TagRow({ tag, className, onNav }: { tag: Tag; className: string; onNav: () => void }) {
  return (
    <NavLink
      to={`/tags/${tag.id}`}
      onClick={onNav}
      className={({ isActive }) => cn(className, isActive && "bg-accent")}
    >
      <Hash className="h-4 w-4 shrink-0 max-sm:h-5 max-sm:w-5" />
      <span className="truncate">{tag.name}</span>
      {tag.noteCount > 0 && (
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground max-sm:text-sm">{tag.noteCount}</span>
      )}
    </NavLink>
  );
}

// A small, non-collapsible subheading inside a section (e.g. "Frequently used").
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    // Full-strength muted-foreground, deliberately NOT the 70% this used to ask for.
    // `text-muted-foreground/70` never rendered: every palette colour here is a var()
    // holding a hex, and Tailwind cannot slice an alpha out of one, so it emitted no
    // rule and this label has always been full strength. Honouring the old intent now
    // would drop 10px uppercase text to 2.78:1 on light and 3.47:1 on dark, well under
    // the 4.5:1 that text this size needs. The intent was measured and rejected, not
    // forgotten — leaving the class dead would have hidden that decision.
    <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground max-sm:px-3 max-sm:pb-1 max-sm:pt-1.5 max-sm:text-xs">
      {children}
    </div>
  );
}

// Split tags into a "Frequently used" group (the most-tagged, count-desc) and the
// rest (kept alphabetical, as the API returns them). Only groups once the list is
// long enough to benefit — a short list stays a single flat list.
function groupTags(tags: Tag[]): { frequent: Tag[]; rest: Tag[] } {
  if (tags.length <= 5) return { frequent: [], rest: tags };
  const frequent = tags
    .filter((t) => t.noteCount > 0)
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, 5);
  const frequentIds = new Set(frequent.map((t) => t.id));
  const rest = tags.filter((t) => !frequentIds.has(t.id));
  return { frequent, rest };
}

// Predefined pastel palette for folders (plus free-form hex entry).
const PASTELS = [
  "#a7f3d0", "#bae6fd", "#c7d2fe", "#ddd6fe", "#fbcfe8",
  "#fecaca", "#fed7aa", "#fde68a", "#bbf7d0", "#99f6e4",
];

// One popover for BOTH creating and editing a folder — same name + colour form. With
// no `folder` it creates; with a `folder` it opens pre-filled and PATCHes (and offers
// to delete). `trigger` is whatever opens it (the section "+" or a row's edit pencil).
// Create-or-edit a folder, in one popover. With a `folder` it renames and recolours
// that one (and offers to delete it); without, it creates a new one. Keeping both in
// a single component is what guarantees the two forms cannot drift apart — the same
// name field, the same colour swatches, the same keyboard handling.
function FolderFormPopover({ folder, trigger }: { folder?: Folder; trigger: ReactNode }) {
  const isEdit = !!folder;
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState<string>(folder?.color ?? PASTELS[0]);

  // Refill from the folder every time the popover opens, so editing always reflects
  // the folder's current values (and creating always starts from a clean slate).
  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? "");
    setColor(folder?.color ?? PASTELS[0]);
  }, [open, folder?.name, folder?.color]);

  const pending = createFolder.isPending || updateFolder.isPending || deleteFolder.isPending;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (isEdit) await updateFolder.mutateAsync({ id: folder!.id, name: trimmed, color });
    else await createFolder.mutateAsync({ name: trimmed, color });
    setOpen(false);
  };

  // Same window.confirm problem as Trash's "Empty trash": browsers suppress the
  // native dialog in several situations and a suppressed confirm returns false
  // rather than throwing, so "Delete folder" silently did nothing.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = async () => {
    if (!folder) return;
    await deleteFolder.mutateAsync(folder.id);
    setConfirmDelete(false);
    setOpen(false);
  };

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={setOpen}
      title={isEdit ? "Edit folder" : "New folder"}
      // The pencil is an unlabelled icon on a row that is already a link, so name what
      // it edits — "Edit" alone would read as "edit the note/page you are looking at".
      triggerLabel={isEdit ? `Rename or recolour “${folder!.name}”` : "New folder"}
      contentClassName="w-64"
      trigger={trigger}
    >
      <div className="flex flex-col gap-4 p-1 max-sm:gap-6 max-sm:p-4">
        {/* Name — a titled field, mirroring the Color section below. */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground max-sm:text-sm">Name</span>
          <Input placeholder="Folder name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="max-sm:h-12 max-sm:text-base" />
        </div>

        {/* Colour — a preset OR a free-form hex; the helper line spells out the choice
            so the two inputs don't read as competing. */}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground max-sm:text-sm">Color</span>
            {/* Same call as the section label above: the old 80% measured 3.57:1 light /
                3.64:1 dark on 12px text, so full strength stays. */}
            <span className="text-xs text-muted-foreground">Pick a preset, or enter any hex value.</span>
          </div>
          <div className="flex flex-wrap gap-2 max-sm:gap-3">
            {PASTELS.map((c) => (
              <button
                key={c}
                aria-label={`Color ${c}`}
                onClick={() => setColor(c)}
                className="flex h-7 w-7 items-center justify-center rounded-full border max-sm:h-10 max-sm:w-10"
                style={{ background: c }}
              >
                {color === c && <Check className="h-4 w-4 text-black/70 max-sm:h-5 max-sm:w-5" />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="h-9 w-9 shrink-0 rounded-full border max-sm:h-12 max-sm:w-12" style={{ background: color }} />
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="#a7f3d0"
              className="font-mono max-sm:h-12 max-sm:text-base"
            />
          </div>
        </div>

        {/* Actions — set off from the form by a divider so the footer reads as a footer. */}
        <div className="flex flex-col gap-2 border-t pt-4 max-sm:pt-5">
          <Button onClick={submit} disabled={pending || !name.trim()} className="max-sm:h-12 max-sm:text-base">{isEdit ? "Save changes" : "Create folder"}</Button>
          {isEdit && (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm text-destructive transition-colors hover-scrim disabled:opacity-50 max-sm:py-3 max-sm:text-base"
              >
                <Trash2 className="h-4 w-4" /> Delete folder
              </button>
              <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={`Delete “${folder!.name}”?`}
                description="The notes inside are kept — they simply stop belonging to a folder, and lose the accent colour they took from it. Any sub-folders move up one level."
                confirmLabel={deleteFolder.isPending ? "Deleting…" : "Delete folder"}
                destructive
                pending={pending}
                onConfirm={remove}
              />
            </>
          )}
        </div>
      </div>
    </ResponsivePopover>
  );
}

// One folder row, and — recursively — everything nested beneath it. `depth` only
// drives the indentation; the nesting itself comes from the tree the server built.
// Expanded by default, so a new user sees their whole structure rather than a row of
// closed doors.
function FolderNode({ folder, depth }: { folder: Folder; depth: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = folder.children.length > 0;
  return (
    <div>
      <div className="group/folder flex items-center" style={{ paddingLeft: depth * 12 }}>
        <Tooltip label={hasChildren ? (open ? `Hide sub-folders of ${folder.name}` : `Show sub-folders of ${folder.name}`) : undefined}>
          <button onClick={() => setOpen((o) => !o)} className={cn("icon-press rounded p-0.5 text-muted-foreground transition-colors hover-scrim hover:text-foreground max-sm:p-1.5", !hasChildren && "invisible")} aria-label={open ? `Hide sub-folders of ${folder.name}` : `Show sub-folders of ${folder.name}`}>
            {open ? <ChevronDown className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" /> : <ChevronRight className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />}
          </button>
        </Tooltip>
        <NavLink
          to={`/folders/${folder.id}`}
          className={({ isActive }) =>
            cn(NAV_ITEM, "min-w-0 flex-1", isActive && "bg-accent")
          }
        >
          <FolderIcon className="h-4 w-4 shrink-0 max-sm:h-5 max-sm:w-5" style={{ color: folder.color ?? undefined }} />
          <span className="truncate">{folder.name}</span>
        </NavLink>
        {/* Edit affordance: hidden until the row is hovered on desktop (and inert
            while hidden so it can't catch stray clicks), always shown on touch where
            there is no hover. Opens the same name+colour popover, pre-filled. */}
        <FolderFormPopover
          folder={folder}
          trigger={
            <button
              type="button"
              aria-label={`Edit folder ${folder.name}`}
              onClick={(e) => e.stopPropagation()}
              className="icon-press ml-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 pointer-events-none transition-opacity hover-scrim hover:text-foreground focus-visible:opacity-100 group-hover/folder:opacity-100 group-hover/folder:pointer-events-auto max-sm:opacity-100 max-sm:pointer-events-auto max-sm:p-1.5"
            >
              <Pencil className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />
            </button>
          }
        />
      </div>
      {open && hasChildren && folder.children.map((c) => <FolderNode key={c.id} folder={c} depth={depth + 1} />)}
    </div>
  );
}

// The section-header "+" that opens the create form.
function CreateFolderPopover() {
  return (
    <FolderFormPopover
      trigger={
        <motion.button whileTap={{ scale: 0.9 }} aria-label="New folder" className="rounded p-0.5 hover-scrim max-sm:p-1.5">
          <Plus className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />
        </motion.button>
      }
    />
  );
}

function CreateTagPopover() {
  const createTag = useCreateTag();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    await createTag.mutateAsync(name.trim());
    setName("");
    setOpen(false);
  };

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={setOpen}
      title="New tag"
      triggerLabel="New tag"
      contentClassName="w-56"
      trigger={
        <motion.button whileTap={{ scale: 0.9 }} aria-label="New tag" className="rounded p-0.5 hover-scrim max-sm:p-1.5">
          <Plus className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />
        </motion.button>
      }
    >
      {/* Same rhythm as the folder form: titled field, then a divided footer so the
          CTA never crowds the content. */}
      <div className="flex flex-col gap-4 p-1 max-sm:gap-6 max-sm:p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground max-sm:text-sm">Name</span>
          <Input placeholder="Tag name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} className="max-sm:h-12 max-sm:text-base" />
        </div>
        <div className="flex flex-col border-t pt-4 max-sm:pt-5">
          <Button onClick={submit} disabled={createTag.isPending || !name.trim()} className="max-sm:h-12 max-sm:text-base">Create tag</Button>
        </div>
      </div>
    </ResponsivePopover>
  );
}

// Collapsible section header: the label + chevron toggle the list; the trailing
// slot (e.g. a "New" button) stays independently clickable.
// The collapsible "FOLDERS" / "TAGS" headings, each with its own create button. The
// chevron rotates to show the state, and the whole heading is the toggle.
function SectionHeader({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="icon-press flex flex-1 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold uppercase text-muted-foreground transition-colors hover-scrim hover:text-foreground max-sm:gap-1.5 max-sm:px-2.5 max-sm:py-2.5 max-sm:text-sm"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" /> : <ChevronRight className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />}
        {label}
      </button>
      {children}
    </div>
  );
}

/**
 * The rail itself.
 *
 * `onNavigate` fires whenever a destination is chosen — the mobile drawer passes a
 * close function so picking a folder dismisses the drawer, while the desktop
 * sidebar passes nothing and simply stays put.
 *
 * `floating` selects the desktop presentation (a detached, rounded column) rather
 * than the drawer's flush full-height panel.
 *
 * The Folders and Tags sections remember whether they are open only for the life of
 * the component — deliberately not persisted, since the sidebar is short enough
 * that re-opening a section is cheaper than a preference nobody asked to set.
 */
export function Sidebar({ onNavigate, floating = false }: { onNavigate?: () => void; floating?: boolean } = {}) {
  const folders = useFolders();
  const tags = useTags();
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const navItem = NAV_ITEM;
  // Close the mobile drawer after navigating.
  const onNav = () => onNavigate?.();
  const { frequent, rest } = groupTags(tags.data?.tags ?? []);

  return (
    <nav
      className={cn(
        "flex flex-col gap-6 overflow-y-auto overscroll-contain bg-card p-3 max-sm:gap-7 max-sm:p-4",
        // Desktop: an inset, rounded, softly-elevated surface (a lighter take on
        // PRD 1's material for a persistent panel). Mobile drawer: flush + full.
        floating ? "raised-top m-3 h-[calc(100%-1.5rem)] rounded-2xl border shadow-sm" : "h-full w-full"
      )}
      aria-label="Navigation"
    >
      <div className="flex flex-col gap-1 max-sm:gap-1.5">
        <NavLink to="/" onClick={onNav} className={({ isActive }) => cn(navItem, isActive && "bg-accent")} end>
          <Home className="h-4 w-4 max-sm:h-5 max-sm:w-5" /> All notes
        </NavLink>
        <NavLink to="/archive" onClick={onNav} className={({ isActive }) => cn(navItem, isActive && "bg-accent")}>
          <Archive className="h-4 w-4 max-sm:h-5 max-sm:w-5" /> Archive
        </NavLink>
        <NavLink to="/trash" onClick={onNav} className={({ isActive }) => cn(navItem, isActive && "bg-accent")}>
          <Trash2 className="h-4 w-4 max-sm:h-5 max-sm:w-5" /> Trash
        </NavLink>
        <NavLink to="/settings" onClick={onNav} className={({ isActive }) => cn(navItem, isActive && "bg-accent")}>
          <Settings2 className="h-4 w-4 max-sm:h-5 max-sm:w-5" /> Settings
        </NavLink>
      </div>

      <div>
        <SectionHeader label="Folders" open={foldersOpen} onToggle={() => setFoldersOpen((o) => !o)}>
          <CreateFolderPopover />
        </SectionHeader>
        {foldersOpen && (
          <div className="flex flex-col gap-0.5 max-sm:gap-1">
            {folders.data?.folders.map((f) => <FolderNode key={f.id} folder={f} depth={0} />)}
            {folders.data?.folders.length === 0 && <span className="px-2 text-xs text-muted-foreground">No folders</span>}
          </div>
        )}
      </div>

      <div>
        <SectionHeader label="Tags" open={tagsOpen} onToggle={() => setTagsOpen((o) => !o)}>
          <CreateTagPopover />
        </SectionHeader>
        {tagsOpen && (
          <div className="flex flex-col gap-0.5 max-sm:gap-1">
            {frequent.length > 0 && (
              <>
                <GroupLabel>Frequently used</GroupLabel>
                {frequent.map((t) => (
                  <TagRow key={t.id} tag={t} className={navItem} onNav={onNav} />
                ))}
                <GroupLabel>All tags</GroupLabel>
              </>
            )}
            {rest.map((t) => (
              <TagRow key={t.id} tag={t} className={navItem} onNav={onNav} />
            ))}
            {tags.data?.tags.length === 0 && <span className="px-2 text-xs text-muted-foreground">No tags</span>}
          </div>
        )}
      </div>
    </nav>
  );
}
