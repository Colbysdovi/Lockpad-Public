import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Folder as FolderIcon, FolderMinus, FolderPlus, Hash, Plus, X } from "@/components/icons";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Tooltip } from "@/components/ui/tooltip";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import { useFolders, useTags, useCreateTag, useCreateFolder } from "@/lib/hooks";
import type { Folder } from "@/lib/types";
import { cn } from "@/lib/utils";

// The two pickers used everywhere a note's filing is changed: the Organize popover
// on a card, the note detail's Details panel, and the bulk-action bar.
//
// Both share the same idea — a searchable list that can CREATE what you typed if it
// doesn't exist yet. That is what stops "file this under Recipes" turning into a
// three-step detour through a folder-management screen: type the name, press Enter,
// it exists and is applied.
//
// Both also render inside ResponsivePopover, so on desktop they are a popover
// anchored to the trigger and on a phone they are a bottom sheet, with the same
// list inside. The `max-sm:` utilities scattered through the rows are just roomier
// touch targets for the sheet version.

/** A folder tree flattened to a list, keeping the nesting as a `depth` number that
 *  the picker turns into indentation — a searchable list has to be flat, but the
 *  hierarchy is still worth SEEING when choosing where something goes. */
export interface FlatFolder { id: string; name: string; color: string | null; depth: number }

export function flattenFolders(folders: Folder[]): FlatFolder[] {
  const out: FlatFolder[] = [];
  const walk = (list: Folder[], depth: number) => {
    for (const f of list) {
      out.push({ id: f.id, name: f.name, color: f.color, depth });
      walk(f.children, depth + 1);
    }
  };
  walk(folders, 0);
  return out;
}

/**
 * Pick the one folder a note lives in — or take it out of folders entirely.
 *
 * A note has at most one folder, so this is single-select: choosing closes the
 * popover. Typing a name that doesn't exist offers to create it, by clicking the
 * row or just pressing Enter.
 *
 * `value` is the current folder id, or null for a note that isn't filed anywhere.
 * `onChange` receives null when the folder is REMOVED — see the footer action.
 */
export function FolderSelect({
  value,
  onChange,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const { data } = useFolders();
  const createFolder = useCreateFolder();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const flat = useMemo(() => flattenFolders(data?.folders ?? []), [data]);
  const selected = flat.find((f) => f.id === value);

  // "Create" is only offered when the typed name isn't already taken — otherwise
  // the list would invite you to make a second folder with an existing name.
  const trimmed = query.trim();
  const exactExists = flat.some((f) => f.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && !exactExists;

  // Create the typed folder and select it (spec: create-on-type for folders).
  const createAndSelect = async () => {
    if (!canCreate) return;
    const folder = await createFolder.mutateAsync({ name: trimmed });
    onChange(folder.id);
    setQuery("");
    setOpen(false);
  };

  const panel = (
    <Command>
      <CommandInput
        placeholder="Search or create folder…"
        value={query}
        onValueChange={setQuery}
        onKeyDown={(e) => {
          // Enter creates the typed folder when it doesn't already exist.
          if (e.key === "Enter" && canCreate) {
            e.preventDefault();
            createAndSelect();
          }
        }}
        className="max-sm:h-12 max-sm:text-base"
      />
      <CommandList className="max-h-56 overflow-y-auto p-1 max-sm:max-h-[55vh] max-sm:p-1.5">
        {/* Instead of an empty state, offer to create the typed folder. */}
        {canCreate ? (
          <CommandItem value={`__create__ ${trimmed}`} onSelect={createAndSelect} className="max-sm:py-3 max-sm:text-base">
            <FolderPlus className="h-3.5 w-3.5 text-primary" />
            Create folder “{trimmed}”
          </CommandItem>
        ) : (
          <CommandEmpty>No folder found.</CommandEmpty>
        )}
        {flat.map((f) => (
          <CommandItem key={f.id} value={`${f.name} ${f.id}`} onSelect={() => { onChange(f.id); setOpen(false); }} className="max-sm:py-3 max-sm:text-base">
            <span style={{ paddingLeft: f.depth * 8 }} className="flex items-center gap-2">
              <FolderIcon className="h-3.5 w-3.5" style={{ color: f.color ?? undefined }} />
              {f.name}
            </span>
            {value === f.id && <Check className="ml-auto h-3.5 w-3.5" />}
          </CommandItem>
        ))}
      </CommandList>
      {/* Taking a note OUT of a folder is a distinct intent, not "pick the folder
          named nothing" — as a row in the list it read as one more option among many
          and was routinely missed. It gets its own footer action instead, present only
          when there is actually a folder to leave, so it always names the folder it
          removes. Clearing the folder also clears the note's derived accent colour and
          drops it from that folder's list page. */}
      {selected && (
        <div className="border-t p-1 max-sm:p-2">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className="hover-scrim flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-destructive max-sm:py-3 max-sm:text-base"
          >
            <FolderMinus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Remove from “{selected.name}”</span>
          </button>
        </div>
      )}
    </Command>
  );

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}
      title="Folder"
      contentClassName="w-64 p-0"
      trigger={
        <button
          type="button"
          className={cn(
            "hover-scrim flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm",
            className
          )}
        >
          {selected ? (
            <>
              {/* The folder's own icon, tinted with the folder's colour — not a bare
                  dot beside the name. The dot said "this thing has a colour" and left
                  the reader to work out what kind of thing it was; the icon says
                  "folder" and carries the colour at the same time, which is the same
                  pairing the list rows below and the folder chips on a card already
                  use. One less shape in the app meaning something only by position. */}
              <FolderIcon className="h-4 w-4 shrink-0" style={{ color: selected.color ?? "var(--muted-foreground)" }} />
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">No folder</span>
          )}
          <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      }
    >
      {panel}
    </ResponsivePopover>
  );
}

/**
 * Pick any number of tags for a note, creating new ones as you type.
 *
 * Unlike the folder picker this stays OPEN as you choose, since applying three tags
 * in a row is normal and reopening between each would be tedious. The chosen tags
 * render as chips beside the trigger, each with its own remove button, so the
 * current state is readable without opening anything.
 *
 * `value` is the list of selected tag ids and `onChange` receives the full new list
 * — the caller decides what that means (the card patches the note; the bulk bar
 * applies it across a selection).
 */
export function TagMultiSelect({
  value,
  onChange,
  className,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const { data } = useTags();
  const createTag = useCreateTag();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const tags = data?.tags ?? [];
  const selectedTags = tags.filter((t) => value.includes(t.id));

  // One function for both directions: tapping a selected tag removes it, tapping an
  // unselected one adds it. The chips' × buttons call this too.
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  // Create-on-type, same rule as folders: only when the name isn't already a tag.
  // A newly created tag is applied immediately, and the query is cleared so the next
  // one can be typed straight away without the field having to be emptied by hand.
  const exactExists = tags.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());
  const create = async () => {
    const name = query.trim();
    if (!name) return;
    const tag = await createTag.mutateAsync(name);
    onChange([...value, tag.id]);
    setQuery("");
  };

  // The searchable list — identical on desktop (in a popover) and mobile (in a bottom
  // sheet); the sheet just gets roomier touch targets via max-sm: utilities.
  const panel = (
    <Command shouldFilter>
      <CommandInput placeholder="Search or create…" value={query} onValueChange={setQuery} className="max-sm:h-12 max-sm:text-base" />
      <CommandList className="max-h-56 overflow-y-auto p-1 max-sm:max-h-[55vh] max-sm:p-1.5">
        {query.trim() && !exactExists && (
          <CommandItem value={`create ${query}`} onSelect={create} className="max-sm:py-3 max-sm:text-base">
            <Plus className="h-3.5 w-3.5" /> Create “{query.trim()}”
          </CommandItem>
        )}
        <CommandEmpty>Type to create a tag.</CommandEmpty>
        {tags.map((t) => (
          <CommandItem key={t.id} value={t.name} onSelect={() => toggle(t.id)} className="max-sm:py-3 max-sm:text-base">
            <Hash className="h-3.5 w-3.5" /> {t.name}
            {value.includes(t.id) && <Check className="ml-auto h-3.5 w-3.5" />}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );

  return (
    // The chips ARE the value: wrapping onto multiple lines rather than truncating,
    // because a note with six tags should show six tags rather than "+4 more".
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {selectedTags.map((t) => (
        <span key={t.id} className="chip-scrim flex h-9 items-center gap-1 rounded-md px-2.5 text-sm text-foreground">
          #{t.name}
          <Tooltip label={`Remove the #${t.name} tag`}>
            <button
              type="button"
              aria-label={`Remove the #${t.name} tag`}
              onClick={() => toggle(t.id)}
              className="hover-scrim -mr-0.5 rounded p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </span>
      ))}
      <ResponsivePopover
        open={open}
        onOpenChange={setOpen}
        title="Tags"
        contentClassName="w-56 p-0"
        trigger={
          // Dashed border marks this as an "add something" affordance rather than a
          // field with a value — it sits in the same row as the solid-edged chips.
          <button
            type="button"
            className="hover-scrim flex h-9 items-center gap-1 rounded-md border border-dashed border-[color-mix(in_srgb,var(--muted-foreground)_55%,transparent)] px-3 text-sm text-muted-foreground"
          >
            <Hash className="h-4 w-4" /> Tags
          </button>
        }
      >
        {panel}
      </ResponsivePopover>
    </div>
  );
}
