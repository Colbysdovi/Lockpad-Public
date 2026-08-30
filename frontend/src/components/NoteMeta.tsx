import { useEffect, useState } from "react";
import { X, Plus, FileText } from "@/components/icons";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Command, CommandInput, CommandList, CommandItem } from "@/components/ui/command";
import { Tooltip } from "@/components/ui/tooltip";
import { FolderSelect, TagMultiSelect } from "./selectors";
import { useUpdateNote, useLinks, useLinkActions, useTagActions, useNoteLookup } from "@/lib/hooks";
import { useNoteSheet } from "@/lib/useNoteSheet";
import type { Note } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Everything about a note EXCEPT its text: which folder it is in, which tags it
// carries, and which other notes it is connected to.
//
// Sits under the title in the note view — always visible on desktop, and folded
// behind a "Details" toggle on phones so it doesn't push the writing area off the
// first screen.
//
// The links section is the interesting half. It shows both directions:
//   - LINKS: notes this one points at, made with the [[ ]] syntax in the editor or
//     added by hand here.
//   - BACKLINKS: notes pointing AT this one. Nobody creates these deliberately —
//     they accumulate as other notes reference this one, which is what makes the
//     link syntax worth using at all.
// Following either opens that note in the sheet, so reading across a chain of
// linked notes never leaves the page.
//
// `openLinkSignal` is a counter, not a boolean: typing "[[" in the editor increments
// it, and each increment opens the link picker. A boolean would only work once,
// since it would already be true the second time.
// The label column beside each control.
//
// It was `w-14` — 56px, which fits "Folder", "Tags" and "Links" and nothing longer.
// "Étiquettes" is 62px, so in French the label ran straight into the button next to
// it and the two words touched. A fixed width chosen against one language is a
// layout that only holds in that language.
//
// `w-24` (96px) clears the longest label in both, and the labels still align in a
// column, which is what the fixed width was for. It is not `w-auto`: three labels of
// three different widths would leave the controls ragged.
const META_LABEL = "w-24 shrink-0 text-muted-foreground";

export function NoteMeta({
  note,
  openLinkSignal,
  onPicked,
}: {
  note: Note;
  openLinkSignal?: number;
  /** Fired when a note is chosen in the picker. `viaTrigger` says whether the picker
   *  was opened by typing `[[` in the body — only then does the body get a chip. A
   *  pick from the "Link note" button belongs to the metadata panel, and injecting
   *  text into the prose at whatever position the caret happens to be would be a
   *  surprise, not a feature. */
  onPicked?: (target: { id: string; title: string }, viaTrigger: boolean) => void;
}) {
  const t = useT();
  const updateNote = useUpdateNote();
  const tagActions = useTagActions();
  const links = useLinks(note.id);
  const linkActions = useLinkActions();
  const { openNote } = useNoteSheet();
  const [linkPicker, setLinkPicker] = useState(false);
  // Whether the open picker was summoned by the `[[` trigger. Held as state, not
  // derived, because by the time a note is picked the signal that opened it is long
  // past and the two entry points are indistinguishable from here.
  const [pickerViaTrigger, setPickerViaTrigger] = useState(false);

  useEffect(() => {
    if (openLinkSignal && openLinkSignal > 0) {
      setPickerViaTrigger(true);
      setLinkPicker(true);
    }
  }, [openLinkSignal]);

  // The tag picker hands back the full list it wants; the API works one tag at a
  // time. So diff the two and fire only the differences — adding what is new and
  // removing what has gone — rather than clearing and re-applying everything, which
  // would churn the note and briefly show it untagged.
  const onTagsChange = (ids: string[]) => {
    const current = note.tags.map((t) => t.id);
    for (const id of ids) if (!current.includes(id)) tagActions.apply.mutate({ noteId: note.id, tagId: id });
    for (const id of current) if (!ids.includes(id)) tagActions.remove.mutate({ noteId: note.id, tagId: id });
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className={META_LABEL}>{t("noteView.folder")}</span>
        <FolderSelect value={note.folder?.id ?? null} onChange={(id) => updateNote.mutate({ id: note.id, folderId: id })} />
      </div>

      <div className="flex items-start gap-2">
        <span className={cn(META_LABEL, "pt-2")}>{t("noteView.tags")}</span>
        <TagMultiSelect value={note.tags.map((t) => t.id)} onChange={onTagsChange} compact />
      </div>

      <div className="flex items-start gap-2">
        <span className={cn(META_LABEL, "pt-2")}>{t("noteView.links")}</span>
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap gap-1.5">
            {links.data?.links.map((l) => (
              <span key={l.id} className="chip-scrim flex h-9 items-center gap-1 rounded-md px-2.5 text-sm text-foreground">
                {/* Same page glyph as the inline chip in the body, so a reference to a
                    note looks like a reference to a note wherever it appears. Inside
                    the button rather than beside it, so the icon is part of the thing
                    you click instead of dead space next to it. Muted rather than
                    terracotta: here it is a type marker in a row of metadata chips,
                    not something that has to stand out from surrounding prose. */}
                <button className="flex items-center gap-1.5 hover:underline" onClick={() => openNote(l.id)}>
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {l.title || t("note.untitled")}
                </button>
                <Tooltip label={t("noteView.unlink", { title: l.title || t("note.untitled") })}>
                  <button aria-label={t("noteView.unlink", { title: l.title || t("note.untitled") })} onClick={() => linkActions.remove.mutate({ noteId: note.id, targetId: l.id })}>
                    <X className="h-3 w-3" />
                  </button>
                </Tooltip>
              </span>
            ))}
            <ResponsivePopover
              open={linkPicker}
              onOpenChange={(o) => { setLinkPicker(o); if (o) setPickerViaTrigger(false); }}
              title={t("noteView.linkNote")}
              contentClassName="w-72 p-0"
              trigger={
                <button type="button" className="hover-scrim flex h-9 items-center gap-1 rounded-md border border-dashed border-[color-mix(in_srgb,var(--muted-foreground)_55%,transparent)] px-3 text-sm text-muted-foreground">
                  <Plus className="h-4 w-4" /> {t("noteView.linkNoteButton")}
                </button>
              }
            >
              <LinkPicker
                noteId={note.id}
                onPicked={(target) => onPicked?.(target, pickerViaTrigger)}
                onDone={() => setLinkPicker(false)}
              />
            </ResponsivePopover>
          </div>
          {links.data && links.data.backlinks.length > 0 && (
            <div className="mt-2">
              <span className="text-xs uppercase text-muted-foreground">{t("noteView.backlinks")}</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {/* `back: true` — a backlink is the one link in the app that takes you
                    somewhere you have already been, so the panel plays its swap in
                    reverse rather than pretending this is another step forward. */}
                {links.data.backlinks.map((b) => (
                  <button key={b.id} onClick={() => openNote(b.id, undefined, { back: true })} className="chip-scrim rounded px-1.5 py-0.5 text-foreground hover:underline">
                    {b.title || t("note.untitled")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LinkPicker({ noteId, onPicked, onDone }: { noteId: string; onPicked: (t: { id: string; title: string }) => void; onDone: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const linkActions = useLinkActions();
  // Title lookup, NOT the app's full-text search. The picker ran on search until it
  // was found to show nothing for "why" (an English stop word, stripped from the
  // query) and nothing for a half-typed word, because full-text matching works on
  // whole words. Someone picking a note to link is spelling out a title they already
  // know, and expects the list to narrow letter by letter. See useNoteLookup.
  const { data, isPending } = useNoteLookup(q);
  const results = (data?.results ?? []).filter((n) => n.id !== noteId);
  return (
    // Built on Command (cmdk) like every other picker in the app — the folder and tag
    // pickers sitting two rows above this one are the same component. That is what
    // gives it ↑/↓ to move, Enter to choose, and a cursor that the mouse and the
    // keyboard share rather than fight over. It was hand-rolled before, which is why
    // it was the one picker you could not drive from the keyboard: reaching a result
    // meant leaving the field and tabbing through the list one button at a time.
    //
    // shouldFilter={false} because the SERVER already filtered. cmdk's own fuzzy
    // filter would run a second, different match over the results and could hide rows
    // the server deliberately returned — so cmdk is left to do navigation only.
    <Command shouldFilter={false}>
      <CommandInput
        placeholder={t("noteView.linkSearch")}
        value={q}
        onValueChange={setQ}
        className="max-sm:h-12 max-sm:text-base"
      />
      <CommandList className="max-h-56 overflow-y-auto p-1 max-sm:max-h-[55vh] max-sm:p-1.5">
        {results.map((n) => (
          <CommandItem
            key={n.id}
            value={n.id}
            onSelect={() => { linkActions.create.mutate({ noteId, targetNoteId: n.id }); onPicked({ id: n.id, title: n.title }); onDone(); }}
            className="max-sm:py-3 max-sm:text-base"
          >
            <span className="truncate">{n.title || t("note.untitled")}</span>
          </CommandItem>
        ))}
        {/* Not CommandEmpty: that renders off cmdk's own filter count, which is not
            meaningful with filtering switched off. Say something either way, because
            an empty dropdown is indistinguishable from a broken one — and two
            messages, because a blank query and a query that found nothing are
            different facts. Quoting an empty string back ("No notes match “”") reads
            as a glitch, which is the opposite of what this line is here to prevent. */}
        {!isPending && results.length === 0 && (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            {q.trim() ? t("noteView.noMatches", { query: q.trim() }) : t("noteView.noOtherNotes")}
          </p>
        )}
      </CommandList>
    </Command>
  );
}
