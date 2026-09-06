import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Check, ChevronsUpDown, Folder, Hash, Home, Search, X } from "@/components/icons";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ResponsivePopover } from "@/components/ui/responsive-popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import { flattenFolders } from "./selectors";
import { Tooltip } from "@/components/ui/tooltip";
import { useFolders, useSearch, useSearchFacets, useTags } from "@/lib/hooks";
import type { SearchResult, SearchScope } from "@/lib/types";
import { useNoteSheet } from "@/lib/useNoteSheet";
import { cn } from "@/lib/utils";
import { useT, useFormat, useLocale } from "@/lib/i18n";

// The snippet contains only <mark> tags we asked ts_headline to emit; sanitize
// anyway so nothing from note content can inject markup.
const cleanSnippet = (html: string) => DOMPurify.sanitize(html, { ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: [] });

// Recency at a glance, coarser the older it gets: a time for today, a relative
// phrase for this week, a date beyond that. When several notes match, WHEN it was
// last touched is usually what distinguishes the one being looked for.
//
// The three branches used to build their own English suffixes and format dates with
// `toLocaleDateString(undefined, …)`, which asks the BROWSER's locale rather than the
// language the reader chose — so a French interface on an English machine showed
// French labels above English month names. Both halves now come from the app's own
// locale: the word "Edited" from the catalogue, the time from Intl.
function useEditedLabel(): (iso: string) => string {
  const t = useT();
  const format = useFormat();
  const locale = useLocale();

  return (iso: string) => {
    const day = (Date.now() - new Date(iso).getTime()) / 86400000;
    if (day < 1) {
      const time = new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
      return t("search.editedAt", { when: time });
    }
    if (day < 7) return t("search.editedAt", { when: format.relativeTime(iso) });
    return t("search.editedAt", { when: format.longDate(iso) });
  };
}

// Why is this result here?
//
// A note can be found by the name of the folder it is filed in, or of a tag it carries,
// with the words you typed appearing nowhere in the note itself. The row for a note like
// that shows a snippet with nothing highlighted in it — which, without this line, is
// indistinguishable from the search having made a mistake.
//
// The reason is TEXT, not a colour or a lone glyph. That is what makes it work for
// someone who cannot separate two similar tones, and it is what a screen reader can
// read out. The folder icon and the "#" say which kind of thing each chip is at a
// glance; the sr-only words say the same thing to a reader that cannot see them, since
// an aria-hidden icon and a bare name would otherwise announce as two names in a row.
//
// Same chip treatment as the note card's own folder and tag row, deliberately — this is
// the same information about the same note, and it should not look like a new species
// of thing just because it is in a different panel.
function MatchReason({ result }: { result: SearchResult }) {
  const t = useT();
  if (!result.matchedFolder && result.matchedTags.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground max-sm:mt-1.5">
      <span>{t("search.matchedBy")}</span>
      {result.matchedFolder && (
        <span className="chip-scrim flex items-center gap-1 rounded px-1.5 py-0.5 text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]">
          <Folder className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="sr-only">{t("search.matchedFolderSr")}</span>
          {result.matchedFolder.name}
        </span>
      )}
      {result.matchedTags.map((tag) => (
        <span
          key={tag.id}
          className="chip-scrim rounded px-1.5 py-0.5 text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]"
        >
          <span className="sr-only">{t("search.matchedTagSr")}</span>#{tag.name}
        </span>
      ))}
    </span>
  );
}

// The right-hand rail of a scope row: how many notes it would give you, and whether it is
// the one currently chosen.
//
// Both live in one component because their LAYOUT is the point. The tick mark occupies a
// fixed slot that is present on every row, empty or not, so the digits beside it always
// end at the same x — you can read the whole column with your eye travelling straight
// down instead of hunting for where each number happens to sit. Without the reserved
// slot, the selected row's tick shoves its number left by its own width and that one row
// falls out of the column, which is exactly the row you were most likely looking at.
//
// `tabular-nums` is the other half of it: proportional digits make "11" narrower than
// "44", so even right-aligned numbers wobble. Tabular figures are all one width.
//
// A row with no matches shows no number at all rather than a "0". A column of zeroes is a
// lot of ink spent saying "no" repeatedly, and the row stays selectable either way — you
// may scope to an empty folder if you want to. The absence carries the meaning.
//
// The digits alone would announce as "Engineering 3", which could be a folder called
// "Engineering 3". The sr-only phrase makes it a sentence.
function ScopeRowMeta({ count, selected }: { count: number | undefined; selected: boolean }) {
  const t = useT();
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
      {count ? (
        <span className="text-xs tabular-nums text-muted-foreground">
          <span className="sr-only">{t("search.resultCount", { count })}</span>
          <span aria-hidden="true">{count}</span>
        </span>
      ) : null}
      {/* Always rendered, so the column to its left never moves. */}
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {selected && <Check className="h-3.5 w-3.5" />}
      </span>
    </span>
  );
}

// Search this folder, or this tag, or everything.
//
// Reads "All" when nothing is chosen, rather than being blank or absent. A control with
// no value looks broken and invites a click to find out what it does; "All" states the
// default out loud, and it also gives clearing somewhere obvious to live — you clear a
// scope by choosing All, not by hunting for an ✕.
//
// Folders and tags share one list because you are answering one question — where do I
// want to look — and the answer happens to be one of two kinds of thing. Two separate
// controls would make you decide which control to use before you could decide what to
// look in.
//
// ── The scope resolves its own name, and clears itself ──────────────────────────
//
// `scope` carries an id and no name (see SearchScope). The name is looked up from the
// folder and tag lists the app already holds for the sidebar, which is what makes the
// deleted-while-active case fall out rather than need handling: a folder that no longer
// exists resolves to nothing, and the effect below drops the scope. The alternative — a
// filter still showing a folder that is gone, quietly returning nothing forever — is the
// exact "zero results with no explanation" §7 asks us not to produce.
function ScopeSelect({
  scope,
  onScopeChange,
  query,
}: {
  scope: SearchScope | null;
  onScopeChange: (s: SearchScope | null) => void;
  query: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { data: folderData } = useFolders();
  const { data: tagData } = useTags();
  // Only while the list is open — see useSearchFacets. Closing does not throw the
  // numbers away, it just stops asking for new ones, so reopening on the same query is
  // instant rather than briefly blank.
  const { data: facets } = useSearchFacets(query, open);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of facets?.folders ?? []) m.set(f.id, f.count);
    for (const tg of facets?.tags ?? []) m.set(tg.id, tg.count);
    return m;
  }, [facets]);

  const folders = useMemo(() => flattenFolders(folderData?.folders ?? []), [folderData]);
  const tags = tagData?.tags ?? [];

  // Null while the lists are still loading, so a slow first paint is not mistaken for
  // a deleted folder — hence the `data` checks before clearing below.
  const selected =
    scope?.kind === "folder"
      ? folders.find((f) => f.id === scope.id)
      : scope?.kind === "tag"
        ? tags.find((t2) => t2.id === scope.id)
        : undefined;

  useEffect(() => {
    if (!scope) return;
    const loaded = scope.kind === "folder" ? !!folderData : !!tagData;
    if (loaded && !selected) onScopeChange(null);
  }, [scope, selected, folderData, tagData, onScopeChange]);

  const choose = (next: SearchScope | null) => {
    onScopeChange(next);
    setOpen(false);
  };

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={setOpen}
      title={t("search.scope.title")}
      contentClassName="w-64 p-0"
      align="end"
      trigger={
        <button
          type="button"
          aria-label={t("search.scope.title")}
          className="hover-scrim flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* The "everything" glyph is the sidebar's own "All notes" icon, not a new
              one — it already means "your whole library" everywhere else in the app, and
              a second glyph for the same idea would be a second thing to learn. */}
          {scope?.kind === "folder" ? (
            <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : scope?.kind === "tag" ? (
            <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Home className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="max-w-28 truncate">{selected?.name ?? t("search.scope.all")}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      }
    >
      <Command>
        <CommandInput placeholder={t("search.scope.filter")} className="max-sm:h-12 max-sm:text-base" />
        <CommandList className="max-h-56 overflow-y-auto p-1 max-sm:max-h-[55vh] max-sm:p-1.5">
          <CommandEmpty>{t("search.scope.empty")}</CommandEmpty>
          {/* "All" is a row in the list, not a footer action, because it is not a
              destructive "remove" the way FolderSelect's footer is — it is one of the
              choices, and the one you are on by default. */}
          <CommandItem value={t("search.scope.all")} onSelect={() => choose(null)} className="max-sm:py-3 max-sm:text-base">
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
            {t("search.scope.all")}
            {/* `total`, not the sum of the folder counts — a note in no folder at all is
                still a match, and would be missing from a sum. */}
            <ScopeRowMeta count={facets?.total} selected={!scope} />
          </CommandItem>
          {folders.map((f) => (
            <CommandItem
              key={f.id}
              value={`${f.name} ${f.id}`}
              onSelect={() => choose({ kind: "folder", id: f.id })}
              className="max-sm:py-3 max-sm:text-base"
            >
              <span style={{ paddingLeft: f.depth * 8 }} className="flex items-center gap-2">
                <Folder className="h-3.5 w-3.5" style={{ color: f.color ?? undefined }} aria-hidden="true" />
                {f.name}
              </span>
              <ScopeRowMeta count={counts.get(f.id)} selected={scope?.kind === "folder" && scope.id === f.id} />
            </CommandItem>
          ))}
          {tags.map((tg) => (
            <CommandItem
              key={tg.id}
              value={`${tg.name} ${tg.id}`}
              onSelect={() => choose({ kind: "tag", id: tg.id })}
              className="max-sm:py-3 max-sm:text-base"
            >
              <Hash className="h-3.5 w-3.5" aria-hidden="true" />
              {tg.name}
              <ScopeRowMeta count={counts.get(tg.id)} selected={scope?.kind === "tag" && scope.id === tg.id} />
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </ResponsivePopover>
  );
}

// Find a note by typing — Cmd/Ctrl+K from anywhere.
//
// Search runs on the SERVER, over Postgres full-text search, so it matches note
// bodies and not just titles. Each result carries a snippet with the matched words
// already highlighted (Postgres's ts_headline emits the <mark> tags), which is why
// the snippet is HTML rather than plain text — and why it is sanitized on arrival
// even though we know what should be in it. Locked notes never appear: the server
// holds only their ciphertext and has nothing to match against.
//
// The QUERY LIVES IN THE LAYOUT, not here. That is what makes closing the palette
// and reopening it restore the same search instead of a blank field — you can dip
// into a result, come back, and continue down the list you were already working
// through. This component just receives it and reports changes back up.
export function SearchPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  scope,
  onScopeChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  scope: SearchScope | null;
  onScopeChange: (s: SearchScope | null) => void;
}) {
  const t = useT();
  const editedLabel = useEditedLabel();
  const [debounced, setDebounced] = useState(query);
  // Highlighted result for keyboard navigation (↑/↓ move it, Enter opens it).
  const [activeIndex, setActiveIndex] = useState(0);
  const { openNote } = useNoteSheet();
  const { data, isFetching } = useSearch(debounced, scope);
  // The name to put in the "nothing typed yet" prompt. Resolved the same way the
  // selector resolves its own label, so the two can never disagree.
  const { data: folderData } = useFolders();
  const { data: tagData } = useTags();
  const scopeName =
    scope?.kind === "folder"
      ? flattenFolders(folderData?.folders ?? []).find((f) => f.id === scope.id)?.name
      : scope?.kind === "tag"
        ? tagData?.tags.find((tg) => tg.id === scope.id)?.name
        : undefined;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const results = data?.results ?? [];
  // Reset the highlight to the top whenever the result set changes.
  useEffect(() => { setActiveIndex(0); }, [debounced, scope]);
  const activeIdx = Math.min(activeIndex, Math.max(0, results.length - 1));

  // Keep the highlighted row scrolled into view as it moves.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, results.length]);

  // Open the note in the sheet and close the palette. The query is NOT cleared,
  // so reopening the palette shows the same text + result list.
  const go = (id: string) => {
    onOpenChange(false);
    openNote(id);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const r = results[activeIdx];
      if (r) go(r.id);
    } else if (e.key === "Escape") {
      // Escape closes the search (even though the input has text).
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* bg-transparent + overflow-hidden so the frosted query bar and the frosted
          result surface each fill their own half of the rounded panel. */}
      <DialogContent animClassName="search-anim" className="top-[12%] w-[min(92vw,42rem)] max-w-none [translate:-50%_0] gap-0 overflow-hidden bg-transparent p-0 max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:flex max-sm:h-full max-sm:w-full max-sm:[translate:0_0] max-sm:flex-col max-sm:rounded-none" hideClose>
        <DialogTitle className="sr-only">{t("search.title")}</DialogTitle>
        {/* Query bar — shares the panel's near-opaque surface (no frost of its own;
            the dialog overlay already blurs the page behind). */}
        <div className="search-surface flex shrink-0 items-center gap-3 border-b px-4 pt-[env(safe-area-inset-top)]">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onInputKeyDown}
            className="h-14 w-full bg-transparent text-lg outline-none placeholder:text-muted-foreground"
          />
          <ScopeSelect scope={scope} onScopeChange={onScopeChange} query={debounced} />
          {/* Clear the input without leaving search. */}
          {query && (
            <Tooltip label={t("search.clear")} side="bottom">
              <button
                aria-label={t("search.clear")}
                onClick={() => onQueryChange("")}
                className="shrink-0 rounded-md p-2.5 text-muted-foreground hover-scrim hover:text-foreground sm:p-1.5"
              >
                <X className="h-5 w-5 sm:h-4 sm:w-4" />
              </button>
            </Tooltip>
          )}
          {/* Leave search. On desktop Esc / clicking outside dismisses the palette,
              but the mobile palette is full-screen with no outside and no keyboard
              Esc — so it needs an explicit way out. */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="-mr-1 shrink-0 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground hover-scrim hover:text-foreground sm:hidden"
          >
            {t("common.cancel")}
          </button>
        </div>
        {/* Result surface — same near-opaque surface as the query bar, so the whole
            panel reads as one clean pane over the already-blurred backdrop. */}
        {/* A FIXED height once there is something to search for, not a max-height.
            With max-height the panel was as tall as its contents, so switching from a
            folder with nine matches to one with two made the whole modal jump upward and
            take the rows you were reading with it — and the rows you land on are then
            somewhere your eye was not. A stable frame costs some empty space under a short
            list, which is the cheaper of the two.

            Only once a query exists. Before that the panel is showing one line of prompt,
            and reserving 60vh of nothing to hold it would be a large empty box that opens
            every time you press ⌘K. The one jump, from prompt to list, happens on the
            first keystroke and never again.

            On a phone none of this applies — the palette is already full-screen, so its
            height was never in question. */}
        <div
          ref={listRef}
          className={cn(
            "search-surface overflow-y-auto overscroll-contain p-2 max-sm:flex-1 max-sm:p-3",
            query ? "sm:flex sm:h-[60vh] sm:flex-col" : "sm:max-h-[60vh]"
          )}
        >
          {query && results.length === 0 && !isFetching && (
            <p className="p-6 text-center text-sm text-muted-foreground sm:my-auto">{t("search.empty")}</p>
          )}
          {!query && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {scopeName ? t("search.promptInScope", { scope: scopeName }) : t("search.prompt")}
            </p>
          )}
          {results.length > 0 && (
            <>
              {/* Result count — a small section label so the list reads as a distinct
                  group under the query bar rather than running straight into it. */}
              <div className="px-2 pb-1.5 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground max-sm:px-1 max-sm:pb-2.5">
                {t("search.resultCount", { count: results.length })}
              </div>
              <div className="flex flex-col gap-0.5 max-sm:gap-1.5">
                {results.map((r, i) => (
                  <div
                    key={r.id}
                    data-idx={i}
                    onClick={() => go(r.id)}
                    onMouseMove={() => setActiveIndex(i)}
                    aria-selected={i === activeIdx}
                    className={cn(
                      "flex cursor-pointer flex-col rounded-lg px-3 py-2.5 max-sm:px-3.5 max-sm:py-3.5",
                      i === activeIdx ? "bg-accent" : "hover-scrim"
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{r.title || "Untitled"}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{editedLabel(r.updatedAt)}</span>
                    </div>
                    <span
                      className="mt-0.5 line-clamp-2 text-xs text-muted-foreground max-sm:mt-1.5 [&_mark]:bg-yellow-500/40 [&_mark]:text-foreground"
                      dangerouslySetInnerHTML={{ __html: cleanSnippet(r.snippet) }}
                    />
                    {/* Suppressed while a scope is active: every row matched inside the
                        same folder or tag by construction, so repeating it on each one is
                        noise rather than an explanation (§7). */}
                    {!scope && <MatchReason result={r} />}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
