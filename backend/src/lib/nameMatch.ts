// Which folders and tags does this typed query name?
//
// Search matches a note's own text in Postgres (see routes/search.ts). It cannot match
// the note's FOLDER NAME or its TAG NAMES there: `content_tsv` is a generated column,
// and a generated column is forbidden from reading anything but its own row — not a
// limitation of the expression, a limitation of the feature. So the folder and tag
// halves of a search are answered here, in application code, and only the resulting
// IDs are handed to SQL as a plain indexed lookup.
//
// Doing the comparison in JavaScript is not a workaround, it is the same call
// lib/names.ts already made for rename collisions, for the same reason: a single
// user's folders and tags are a few dozen short strings, and the folding this needs
// (case, whitespace, and now accents) is not something Postgres can express without
// an extension this app does not install.
import { prisma } from "../prisma.js";
import { foldForSearch } from "./names.js";

/** Below this, a query is too short to match folder and tag names with.
 *
 *  Content search has no such floor — one character is a legitimate full-text query.
 *  This branch is different in kind: it is a SUBSTRING match against short labels, so
 *  a single letter matches nearly every folder you own and buries the results the
 *  query was actually about. Two is the smallest floor that stops that. */
export const MIN_NAME_QUERY_LENGTH = 2;

export interface NamedRef {
  id: string;
  name: string;
}

/** The folders and tags a query named — with their names, not only their ids.
 *
 *  The names are here because the result rows have to say WHY they matched, and the
 *  only honest source for "the folder that matched" is the same read that decided it
 *  matched. Handing back ids alone and looking the names up again would be two reads
 *  of the same two small tables, with a window between them in which a rename makes
 *  the explanation disagree with the filter that produced it. */
export interface NameMatches {
  folders: NamedRef[];
  tags: NamedRef[];
}

export const NO_NAME_MATCHES: NameMatches = { folders: [], tags: [] };

/** The folders and tags whose names contain `query`, folded for search.
 *
 *  Names are read on every call rather than cached. That is what makes a folder
 *  renamed mid-search matchable under its new name on the very next keystroke, with
 *  nothing to invalidate — and it costs one small read of a table the app already
 *  loads in full for the sidebar. */
export async function matchFolderAndTagNames(query: string): Promise<NameMatches> {
  // Fold FIRST, then measure. The floor is about how short the thing being matched
  // with is, not how many keys were pressed to produce it: "é " is two characters
  // typed and one character matched, and it is the one character that does the damage.
  const needle = foldForSearch(query);
  if (needle.length < MIN_NAME_QUERY_LENGTH) return NO_NAME_MATCHES;

  const [folders, tags] = await Promise.all([
    prisma.folder.findMany({ select: { id: true, name: true } }),
    prisma.tag.findMany({ select: { id: true, name: true } }),
  ]);

  const matches = (r: NamedRef) => foldForSearch(r.name).includes(needle);
  // Sorted by name so a note carrying several matching tags always lists them the same
  // way round — a result row that reshuffles its own explanation between keystrokes
  // reads as flicker, not as information.
  const byName = (a: NamedRef, b: NamedRef) => a.name.localeCompare(b.name);

  return {
    folders: folders.filter(matches).sort(byName),
    tags: tags.filter(matches).sort(byName),
  };
}
