import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronRight, ChevronDown, Folder as FolderIcon, Hash, Plus, Pencil, Home, Archive, Trash2, Check, Settings2, TriangleAlert } from "@/components/icons";
import { useFolders, useTags, useCreateFolder, useUpdateFolder, useDeleteFolder, useCreateTag, useUpdateTag } from "@/lib/hooks";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Folder, Tag } from "@/lib/types";
import { cn } from "@/lib/utils";
import { findNameCollision } from "@/lib/names";
import { flattenFolders } from "./selectors";
import { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { EASE_FOLLOW_CSS, FOLDER_COLOR_REVEAL_MS } from "@/lib/motion";

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
  const t = useT();
  return (
    // The row is a link plus an edit affordance, so the link can no longer BE the
    // row — same structure the folder rows already use, for the same reason: a
    // button nested inside a NavLink would navigate on its way to opening.
    <div className="group/tag flex items-center">
      <NavLink
        to={`/tags/${tag.id}`}
        onClick={onNav}
        className={({ isActive }) => cn(className, "min-w-0 flex-1", isActive && "bg-accent")}
      >
        <Hash className="h-4 w-4 shrink-0 max-sm:h-5 max-sm:w-5" />
        <span className="truncate">{tag.name}</span>
        {tag.noteCount > 0 && (
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground max-sm:text-sm">{tag.noteCount}</span>
        )}
      </NavLink>
      {/* Hidden until the row is hovered on desktop (and inert while hidden so it
          cannot catch stray clicks), always shown on touch where there is no hover.
          Character-for-character the folder row's treatment — a tag row and a folder
          row sit in the same column and should not reveal their controls differently. */}
      <TagFormPopover
        tag={tag}
        trigger={
          <button
            type="button"
            aria-label={t("nav.tag.renameNamed", { name: tag.name })}
            onClick={(e) => e.stopPropagation()}
            className="icon-press ml-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 pointer-events-none transition-opacity hover-scrim hover:text-foreground focus-visible:opacity-100 group-hover/tag:opacity-100 group-hover/tag:pointer-events-auto max-sm:opacity-100 max-sm:pointer-events-auto max-sm:p-1.5"
          >
            <Pencil className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />
          </button>
        }
      />
    </div>
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

// Predefined pastel palette for folders (plus free-form hex entry). Shown by default,
// unchanged from before "More colors" existed — nothing about opening the picker for
// the first time looks any different.
const PASTELS = [
  "#a7f3d0", "#bae6fd", "#c7d2fe", "#ddd6fe", "#fbcfe8",
  "#fecaca", "#fed7aa", "#fde68a", "#bbf7d0", "#99f6e4",
];

// A second tier, behind "More colors": a richer twin of each PASTELS hue (same family,
// deeper/more saturated), plus five hues PASTELS has no equivalent for at all
// (raspberry, fuchsia, orchid, cyan, lime). Checked against Lockpad's actual light and
// dark `--card` tokens before picking these — every one of the 15 still clears WCAG's
// 3:1 non-text contrast bar for the existing selected-state checkmark (weakest is deep
// indigo at ~4.6:1), so the checkmark itself needed no change to work here.
const MORE_COLORS = [
  "#34d399", "#38bdf8", "#818cf8", "#a78bfa", "#f472b6",
  "#f87171", "#fb923c", "#fbbf24", "#4ade80", "#2dd4bf",
  "#fb7185", "#e879f9", "#c084fc", "#22d3ee", "#a3e635",
];

// Every catalogue key under nav.field.colorName.* — narrowed from the full MessageKey
// union via the prefix, so a typo or a key that never made it into catalog.en.ts is a
// compile error here rather than a swatch that silently announces nothing.
type ColorNameKey = Extract<MessageKey, `nav.field.colorName.${string}`>;

// Hex → its translatable name, shared by both tiers' swatches. A raw hex value
// ("Color #a7f3d0") stopped being a usable screen-reader label once there were 25
// swatches to tell apart instead of 10 — two shades of the same hue are indistinguishable
// by ear as hex codes, but not as "Soft mint" vs. "Deep mint".
const COLOR_NAME_KEYS: Record<string, ColorNameKey> = {
  "#a7f3d0": "nav.field.colorName.softMint",
  "#bae6fd": "nav.field.colorName.softSky",
  "#c7d2fe": "nav.field.colorName.softIndigo",
  "#ddd6fe": "nav.field.colorName.softViolet",
  "#fbcfe8": "nav.field.colorName.softPink",
  "#fecaca": "nav.field.colorName.softRed",
  "#fed7aa": "nav.field.colorName.softOrange",
  "#fde68a": "nav.field.colorName.softAmber",
  "#bbf7d0": "nav.field.colorName.softGreen",
  "#99f6e4": "nav.field.colorName.softTeal",
  "#34d399": "nav.field.colorName.deepMint",
  "#38bdf8": "nav.field.colorName.deepSky",
  "#818cf8": "nav.field.colorName.deepIndigo",
  "#a78bfa": "nav.field.colorName.deepViolet",
  "#f472b6": "nav.field.colorName.deepPink",
  "#f87171": "nav.field.colorName.deepRed",
  "#fb923c": "nav.field.colorName.deepOrange",
  "#fbbf24": "nav.field.colorName.deepAmber",
  "#4ade80": "nav.field.colorName.deepGreen",
  "#2dd4bf": "nav.field.colorName.deepTeal",
  "#fb7185": "nav.field.colorName.raspberry",
  "#e879f9": "nav.field.colorName.fuchsia",
  "#c084fc": "nav.field.colorName.orchid",
  "#22d3ee": "nav.field.colorName.cyan",
  "#a3e635": "nav.field.colorName.lime",
};

// One swatch button, shared by the default row and the "More colors" row — so the two
// cannot drift into different sizes, hit targets, or labelling as either grows.
function ColorSwatch({ color, selected, onSelect }: { color: string; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const nameKey = COLOR_NAME_KEYS[color];
  const name = nameKey ? t(nameKey) : color;
  return (
    <button
      type="button"
      aria-label={t("nav.field.colorSwatch", { value: name })}
      // The checkmark is the only sign of selection, and it is purely visual. Without
      // this a screen reader heard 25 identical-sounding buttons and no way to tell
      // which colour the folder currently has.
      aria-pressed={selected}
      onClick={onSelect}
      className="flex h-7 w-7 items-center justify-center rounded-full border max-sm:h-10 max-sm:w-10"
      style={{ background: color }}
    >
      {selected && <Check className="h-4 w-4 text-black/70 max-sm:h-5 max-sm:w-5" />}
    </button>
  );
}

// One popover for BOTH creating and editing a folder — same name + colour form. With
// no `folder` it creates; with a `folder` it opens pre-filled and PATCHes (and offers
// to delete). `trigger` is whatever opens it (the section "+" or a row's edit pencil).
// The name field both rename forms use, and the reason they cannot drift apart.
//
// A tag rename and a folder rename are the same interaction wearing two nouns: type
// a name, be told at once if it is taken, save when it is not. Building that twice
// would mean two chances to word the message differently, put it somewhere else, or
// forget the aria wiring on one of them — so there is one field, and the entity name
// is a prop.
//
// ── Why the check is instant, and why the server still repeats it ───────────
//
// The full tag list and the full folder tree are already in the client's cache —
// the sidebar is rendering from them — so the answer needs no round trip and the
// message can appear on the keystroke that causes it. That is the whole reason this
// is worth doing inline rather than on submit.
//
// It is still only a courtesy. The snapshot it reads can be stale (a second tab, a
// rename racing a create), so the server checks again and refuses; `serverError`
// below is where that refusal surfaces, in the same place and the same shape as the
// live warning, so a collision looks the same however it was caught.
function NameField({
  entity,
  value,
  onChange,
  onSubmit,
  takenBy,
  serverError,
  autoFocus,
}: {
  entity: "tag" | "folder";
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** Every name that is NOT available — the caller has already removed the thing
   *  being renamed, so renaming something to its own name is never a collision. */
  takenBy: string[];
  serverError?: string | null;
  autoFocus?: boolean;
}) {
  const t = useT();
  const collision = findNameCollision(value, takenBy);
  // The server's refusal wins the slot when there is one: it is the more recent, and
  // more authoritative, answer about the same field.
  const message = serverError ?? (collision ? `Another ${entity} is already called \u201C${collision}\u201D.` : null);
  const messageId = `${entity}-name-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground max-sm:text-sm">{t("nav.field.name")}</span>
      <Input
        autoFocus={autoFocus}
        placeholder={entity === "tag" ? t("nav.field.namePlaceholder.tag") : t("nav.field.namePlaceholder.folder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        // Both of these, not just the visual state: aria-invalid is what tells a
        // screen reader the field is the problem, and aria-describedby is what ties
        // the sentence below to it so the reason is read out with it rather than
        // being stranded as loose text further down the form.
        aria-invalid={!!message}
        aria-describedby={message ? messageId : undefined}
        className={cn("max-sm:h-12 max-sm:text-base", message && "border-destructive")}
      />
      {message && (
        // role="alert" so it is announced when it appears, not only when the field
        // is next focused. The glyph is the second channel: WCAG 1.4.1 means the red
        // cannot be the only thing saying "this is wrong", and the words themselves
        // plus the icon both carry it without colour.
        <p id={messageId} role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}

// Create-or-edit a folder, in one popover. With a `folder` it renames and recolours
// that one (and offers to delete it); without, it creates a new one. Keeping both in
// a single component is what guarantees the two forms cannot drift apart — the same
// name field, the same colour swatches, the same keyboard handling.
function FolderFormPopover({ folder, trigger }: { folder?: Folder; trigger: ReactNode }) {
  const t = useT();
  const isEdit = !!folder;
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState<string>(folder?.color ?? PASTELS[0]);
  const [serverError, setServerError] = useState<string | null>(null);
  // "More colors": closed by default, opened by the reset effect below (with no
  // animation, since that is the popover appearing, not a click) when the folder
  // being edited already has one of the hidden colours.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreAnimRef = useRef<Animation | null>(null);

  // Every folder name in the tree except this one's.
  //
  // The whole tree, flattened — because the rule here is that a folder name is unique
  // ACROSS THE TREE, not merely among its siblings. That is the wider of the two
  // possible rules and it was chosen deliberately: folder names appear in flat lists
  // all over this app (the composer's picker, the bulk bar's Move menu, a note card's
  // folder chip) where the parent is never shown, so two folders called "Drafts" are
  // indistinguishable in every one of them. The server enforces the same rule; see
  // the note on PATCH /folders/:id.
  //
  // Collapsed or scrolled-out-of-view folders are included, obviously — the check
  // reads the data, not the screen, so a collision with a folder you cannot currently
  // see is caught exactly like any other.
  //
  // Empty while CREATING, and that is a scope decision rather than an oversight.
  // This work covers renaming; creation is explicitly untouched, and the server does
  // not enforce uniqueness on POST /folders either. A form that blocked a name the
  // server would happily accept would be the client inventing a rule of its own —
  // worse than the gap it papers over. The seam it leaves (you can still create a
  // duplicate, and then cannot rename anything else to that name) is real and is
  // recorded as a follow-up rather than fixed halfway here.
  const folders = useFolders();
  const takenBy = isEdit
    ? flattenFolders(folders.data?.folders ?? [])
        .filter((f) => f.id !== folder!.id)
        .map((f) => f.name)
    : [];

  // Refill from the folder every time the popover opens, so editing always reflects
  // the folder's current values (and creating always starts from a clean slate).
  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? "");
    setColor(folder?.color ?? PASTELS[0]);
    setServerError(null);
    // Land straight on "More colors" open, unanimated, when the folder's own colour
    // lives there — otherwise it would read as if editing had cleared the colour,
    // until the row was found and opened by hand.
    setMoreOpen(!!folder?.color && MORE_COLORS.includes(folder.color));
  }, [open, folder?.name, folder?.color]);

  // Opens or closes the "More colors" row, animating its height from whatever it
  // currently measures to its real natural height — never a guessed max-height, since
  // 15 swatches wrap differently at every popover width. `scrollHeight` reports that
  // real height correctly even while the row is still clipped to 0, so both ends of
  // the animation are read before React's own re-render (from setMoreOpen) touches the
  // DOM at all.
  const toggleMore = () => {
    const opening = !moreOpen;
    const el = moreRef.current;
    setMoreOpen(opening);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (reduce?.matches) return; // the row's own height classes just snap instead
    const from = el.offsetHeight;
    const to = opening ? el.scrollHeight : 0;
    moreAnimRef.current?.cancel(); // don't stack a second reveal on a fast double-click
    el.style.overflow = "hidden";
    const anim = el.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: FOLDER_COLOR_REVEAL_MS,
      easing: EASE_FOLLOW_CSS,
    });
    moreAnimRef.current = anim;
    const settle = () => {
      if (moreAnimRef.current !== anim) return; // superseded by a later toggle
      el.style.overflow = "";
      moreAnimRef.current = null;
    };
    anim.addEventListener("finish", settle);
    anim.addEventListener("cancel", settle);
  };

  // A stale refusal outlives the name that caused it otherwise: type into the field
  // and the server's message would sit there contradicting the live check.
  useEffect(() => setServerError(null), [name]);

  const pending = createFolder.isPending || updateFolder.isPending || deleteFolder.isPending;
  // True when the colour is not one of the 25 swatches, i.e. it came from the hex field.
  // Compared case-insensitively because the field accepts "#A7F3D0" as happily as
  // "#a7f3d0", and a hand-typed preset should still tick its swatch, not Custom.
  const isCustomColor = ![...PASTELS, ...MORE_COLORS].includes(color.trim().toLowerCase());
  const blocked = !!findNameCollision(name, takenBy);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || blocked) return;
    try {
      if (isEdit) await updateFolder.mutateAsync({ id: folder!.id, name: trimmed, color });
      else await createFolder.mutateAsync({ name: trimmed, color });
      setOpen(false);
    } catch (e) {
      // The server's message is written to be read by a person (see errors.ts), so
      // it is shown verbatim rather than replaced with a guess about what went wrong.
      setServerError(e instanceof ApiError ? e.message : t("nav.saveFailed"));
    }
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
      title={isEdit ? t("nav.folder.edit") : t("nav.folder.new")}
      // The pencil is an unlabelled icon on a row that is already a link, so name what
      // it edits — "Edit" alone would read as "edit the note/page you are looking at".
      triggerLabel={isEdit ? t("nav.folder.rename", { name: folder!.name }) : t("nav.folder.new")}
      contentClassName="w-64"
      trigger={trigger}
    >
      <div className="flex flex-col gap-4 p-1 max-sm:gap-6 max-sm:p-4">
        {/* Name — a titled field, mirroring the Color section below. */}
        <NameField entity="folder" value={name} onChange={setName} onSubmit={submit} takenBy={takenBy} serverError={serverError} />

        {/* Colour — two ways to choose one, laid out as two things rather than explained.

            It used to be a single block under one label, with a helper line ("Pick a
            preset, or enter any hex value") doing the work the layout was not doing:
            presets, the "More colors" toggle and the hex row all stood at the same level,
            the toggle sat BETWEEN the presets and the custom row as though it belonged to
            the hex field, and the hex row had no label at all. The sentence was
            describing a structure the screen did not have.

            Now the structure carries it. "Color" is the field; beneath it, two groups
            with their own small headings — Palette (the presets, with More colors
            directly under the swatches it extends) and Custom (the hex value), divided
            by a hairline. The helper line is gone because nothing is left for it to say.

            The sub-headings reuse the sidebar's own section-heading treatment (10px,
            semibold, uppercase, tracked — see the group label near the top of this file)
            so they read as a tier BELOW "Color" and not as rival fields. */}
        <div className="flex flex-col gap-2.5 max-sm:gap-3">
          <span className="text-xs font-medium text-muted-foreground max-sm:text-sm">{t("nav.field.color")}</span>

          {/* ── Palette ─────────────────────────────────────────────────────────── */}
          <div role="group" aria-label={t("nav.field.presets")} className="flex flex-col gap-2 max-sm:gap-3">
            <span aria-hidden="true" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground max-sm:text-xs">
              {t("nav.field.presets")}
            </span>
            <div className="flex flex-wrap gap-2 max-sm:gap-3">
              {PASTELS.map((c) => (
                <ColorSwatch key={c} color={c} selected={color === c} onSelect={() => setColor(c)} />
              ))}
            </div>
            {/* One flex child for the toggle AND the row it reveals, so the group's own
                gap inserts exactly one gap here instead of a gap on either side of a
                collapsed, zero-height sibling. Inside the Palette group now, directly
                under the swatches it extends, rather than floating between the presets
                and the custom row as if it belonged to either. */}
            <div className="flex flex-col">
              <button
                type="button"
                aria-expanded={moreOpen}
                onClick={toggleMore}
                className="-mx-1 flex items-center gap-1 self-start rounded px-1 py-1 text-xs text-muted-foreground transition-colors hover-scrim hover:text-foreground max-sm:text-sm"
              >
                {t(moreOpen ? "nav.field.fewerColors" : "nav.field.moreColors")}
                <ChevronDown
                  aria-hidden="true"
                  className={cn("h-3.5 w-3.5 transition-transform max-sm:h-4 max-sm:w-4", moreOpen && "rotate-180")}
                />
              </button>
              {/* Always mounted (never conditionally rendered) so `moreRef` has a real,
                  measurable element to read `scrollHeight` from at the moment of the very
                  first click — a row that only mounts once opened would report 0 for its
                  own natural height on that first toggle. Collapsed by the plain height/
                  overflow utilities at rest; `toggleMore` takes over with an explicit
                  inline height only for the duration of the animation itself. */}
              <div ref={moreRef} className={cn(!moreOpen && "h-0 overflow-hidden")}>
                <div className="flex flex-wrap gap-2 pt-2 max-sm:gap-3 max-sm:pt-3">
                  {MORE_COLORS.map((c) => (
                    <ColorSwatch key={c} color={c} selected={color === c} onSelect={() => setColor(c)} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Custom ──────────────────────────────────────────────────────────── */}
          {/* The hairline is what makes these two groups rather than one long list: the
              presets end, and a different kind of input begins. */}
          <div role="group" aria-label={t("nav.field.custom")} className="flex flex-col gap-2 border-t pt-3 max-sm:gap-3 max-sm:pt-4">
            <span aria-hidden="true" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground max-sm:text-xs">
              {t("nav.field.custom")}
            </span>
            <div className="flex items-center gap-2">
              {/* A preview of the value in the field, and — new — the Custom group's own
                  selected state. It used to show the same circle whatever was chosen, so
                  with a preset selected the screen showed that colour twice, once ticked
                  and once not, and nothing said which of the two inputs was in charge.
                  The tick now appears here only when the colour matches no swatch:
                  exactly one place on the form carries the tick at any moment. */}
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border max-sm:h-12 max-sm:w-12",
                  isCustomColor && "ring-2 ring-primary ring-offset-2 ring-offset-card"
                )}
                style={{ background: color }}
              >
                {isCustomColor && <Check className="h-4 w-4 text-black/70 max-sm:h-5 max-sm:w-5" />}
              </span>
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#a7f3d0"
                // Its only label used to be the placeholder, which disappears as soon as
                // there is a value — and there always is one.
                aria-label={t("nav.field.customHex")}
                className="font-mono max-sm:h-12 max-sm:text-base"
              />
            </div>
          </div>
        </div>

        {/* Actions — set off from the form by a divider so the footer reads as a footer. */}
        <div className="flex flex-col gap-2 border-t pt-4 max-sm:pt-5">
          {/* Unavailable while the name collides. The `disabled` attribute is what
              makes that perceivable without colour — assistive tech announces the
              control as unavailable — and the message above says why. */}
          <Button onClick={submit} disabled={pending || !name.trim() || blocked} className="max-sm:h-12 max-sm:text-base">{isEdit ? t("nav.form.save") : t("nav.form.createFolder")}</Button>
          {isEdit && (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm text-destructive transition-colors hover-scrim disabled:opacity-50 max-sm:py-3 max-sm:text-base"
              >
                <Trash2 className="h-4 w-4" /> {t("nav.folder.delete")}
              </button>
              <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={t("nav.folder.deleteTitle", { name: folder!.name })}
                description={t("nav.folder.deleteBody")}
                confirmLabel={deleteFolder.isPending ? t("nav.folder.deleting") : t("nav.folder.delete")}
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
  const t = useT();
  const [open, setOpen] = useState(true);
  const hasChildren = folder.children.length > 0;
  return (
    <div>
      <div className="group/folder flex items-center" style={{ paddingLeft: depth * 12 }}>
        <Tooltip label={hasChildren ? (open ? `Hide sub-folders of ${folder.name}` : `Show sub-folders of ${folder.name}`) : undefined}>
          <button onClick={() => setOpen((o) => !o)} className={cn("icon-press rounded p-0.5 text-muted-foreground transition-colors hover-scrim hover:text-foreground max-sm:p-1.5", !hasChildren && "invisible")} aria-label={open ? t("nav.folder.collapse", { name: folder.name }) : t("nav.folder.expand", { name: folder.name })}>
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
              aria-label={t("nav.folder.editNamed", { name: folder.name })}
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
  const t = useT();
  return (
    <FolderFormPopover
      trigger={
        <motion.button whileTap={{ scale: 0.9 }} aria-label={t("nav.folder.new")} className="rounded p-0.5 hover-scrim max-sm:p-1.5">
          <Plus className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />
        </motion.button>
      }
    />
  );
}

// Create-or-edit a tag, in one popover — the same shape as FolderFormPopover above,
// for the same reason: one component means the create form and the rename form
// cannot drift into two different-looking versions of the same field.
//
// Renaming is the whole point of the edit half. Until it existed, a tag's name was
// effectively permanent: correcting a typo meant removing the tag from every note
// that carried it, deleting it, creating a correctly-spelled one, and reapplying it
// everywhere. A rename touches the tag row alone — every note keeps the tag, because
// the association is keyed on its id and never mentions the name.
//
// No colour section, unlike folders: tags have no colour. The popover is narrower to
// match what it actually holds rather than padding it out to look like its sibling.
function TagFormPopover({ tag, trigger }: { tag?: Tag; trigger: ReactNode }) {
  const t = useT();
  const isEdit = !!tag;
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(tag?.name ?? "");
  const [serverError, setServerError] = useState<string | null>(null);

  // Every other tag's name. Already in the cache — the sidebar is rendering the list
  // right now — which is what lets the collision warning appear on the keystroke
  // rather than after a round trip.
  //
  // Empty while creating, matching the folder form: creation is out of scope for this
  // work and the server does not enforce uniqueness on POST /tags either (it upserts,
  // so an exact repeat quietly returns the existing tag). See the note there.
  const tags = useTags();
  const takenBy = isEdit
    ? (tags.data?.tags ?? []).filter((t) => t.id !== tag!.id).map((t) => t.name)
    : [];

  useEffect(() => {
    if (!open) return;
    setName(tag?.name ?? "");
    setServerError(null);
  }, [open, tag?.name]);

  useEffect(() => setServerError(null), [name]);

  const pending = createTag.isPending || updateTag.isPending;
  const blocked = !!findNameCollision(name, takenBy);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || blocked) return;
    try {
      if (isEdit) await updateTag.mutateAsync({ id: tag!.id, name: trimmed });
      else await createTag.mutateAsync(trimmed);
      setName("");
      setOpen(false);
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t("nav.saveFailed"));
    }
  };

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={setOpen}
      title={isEdit ? t("nav.tag.edit") : t("nav.tag.new")}
      // The pencil is an unlabelled icon on a row that is already a link, so name
      // what it edits — same reasoning as the folder row's.
      triggerLabel={isEdit ? t("nav.tag.rename", { name: tag!.name }) : t("nav.tag.new")}
      contentClassName="w-56"
      trigger={trigger}
    >
      {/* Same rhythm as the folder form: titled field, then a divided footer so the
          CTA never crowds the content. */}
      <div className="flex flex-col gap-4 p-1 max-sm:gap-6 max-sm:p-4">
        <NameField entity="tag" value={name} onChange={setName} onSubmit={submit} takenBy={takenBy} serverError={serverError} />
        <div className="flex flex-col border-t pt-4 max-sm:pt-5">
          <Button onClick={submit} disabled={pending || !name.trim() || blocked} className="max-sm:h-12 max-sm:text-base">{isEdit ? t("nav.form.save") : t("nav.form.createTag")}</Button>
        </div>
      </div>
    </ResponsivePopover>
  );
}

// The section-header "+" that opens the create form.
function CreateTagPopover() {
  const t = useT();
  return (
    <TagFormPopover
      trigger={
        <motion.button whileTap={{ scale: 0.9 }} aria-label={t("nav.tag.new")} className="rounded p-0.5 hover-scrim max-sm:p-1.5">
          <Plus className="h-3.5 w-3.5 max-sm:h-[18px] max-sm:w-[18px]" />
        </motion.button>
      }
    />
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
  const t = useT();
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
      aria-label={t("nav.label")}
    >
      <div className="flex flex-col gap-1 max-sm:gap-1.5">
        <NavLink to="/" onClick={onNav} className={({ isActive }) => cn(navItem, isActive && "bg-accent")} end>
          <Home className="h-4 w-4 max-sm:h-5 max-sm:w-5" /> {t("nav.allNotes")}
        </NavLink>
        <NavLink to="/archive" onClick={onNav} className={({ isActive }) => cn(navItem, isActive && "bg-accent")}>
          <Archive className="h-4 w-4 max-sm:h-5 max-sm:w-5" /> {t("nav.archive")}
        </NavLink>
        <NavLink to="/trash" onClick={onNav} className={({ isActive }) => cn(navItem, isActive && "bg-accent")}>
          <Trash2 className="h-4 w-4 max-sm:h-5 max-sm:w-5" /> {t("nav.trash")}
        </NavLink>
        <NavLink to="/settings" onClick={onNav} className={({ isActive }) => cn(navItem, isActive && "bg-accent")}>
          <Settings2 className="h-4 w-4 max-sm:h-5 max-sm:w-5" /> {t("nav.settings")}
        </NavLink>
      </div>

      <div>
        <SectionHeader label={t("nav.folders")} open={foldersOpen} onToggle={() => setFoldersOpen((o) => !o)}>
          <CreateFolderPopover />
        </SectionHeader>
        {foldersOpen && (
          <div className="flex flex-col gap-0.5 max-sm:gap-1">
            {folders.data?.folders.map((f) => <FolderNode key={f.id} folder={f} depth={0} />)}
            {folders.data?.folders.length === 0 && <span className="px-2 text-xs text-muted-foreground">{t("nav.folders.empty")}</span>}
          </div>
        )}
      </div>

      <div>
        <SectionHeader label={t("nav.tags")} open={tagsOpen} onToggle={() => setTagsOpen((o) => !o)}>
          <CreateTagPopover />
        </SectionHeader>
        {tagsOpen && (
          <div className="flex flex-col gap-0.5 max-sm:gap-1">
            {frequent.length > 0 && (
              <>
                <GroupLabel>{t("nav.tags.frequent")}</GroupLabel>
                {frequent.map((t) => (
                  <TagRow key={t.id} tag={t} className={navItem} onNav={onNav} />
                ))}
                <GroupLabel>{t("nav.tags.all")}</GroupLabel>
              </>
            )}
            {rest.map((t) => (
              <TagRow key={t.id} tag={t} className={navItem} onNav={onNav} />
            ))}
            {tags.data?.tags.length === 0 && <span className="px-2 text-xs text-muted-foreground">{t("nav.tags.empty")}</span>}
          </div>
        )}
      </div>
    </nav>
  );
}
