import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Search, X } from "@/components/icons";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { useSearch } from "@/lib/hooks";
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
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const t = useT();
  const editedLabel = useEditedLabel();
  const [debounced, setDebounced] = useState(query);
  // Highlighted result for keyboard navigation (↑/↓ move it, Enter opens it).
  const [activeIndex, setActiveIndex] = useState(0);
  const { openNote } = useNoteSheet();
  const { data, isFetching } = useSearch(debounced);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const results = data?.results ?? [];
  // Reset the highlight to the top whenever the result set changes.
  useEffect(() => { setActiveIndex(0); }, [debounced]);
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
        <div ref={listRef} className="search-surface overflow-y-auto overscroll-contain p-2 max-sm:flex-1 max-sm:p-3 sm:max-h-[60vh]">
          {query && results.length === 0 && !isFetching && (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("search.empty")}</p>
          )}
          {!query && (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("search.prompt")}</p>
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
