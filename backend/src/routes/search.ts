import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { matchFolderAndTagNames } from "../lib/nameMatch.js";
import { lookupQuery, searchFacetsQuery, searchQuery } from "../schemas.js";

// What a folder or tag name match is worth, added to the note's content rank.
//
// The number has a job, and §3 of the PRD states it: a note whose ONLY match is its
// folder or tag "still appears in results, positioned so it is not effectively
// invisible beneath a long tail of weak content matches." So it cannot be zero. It
// should not be enormous either — a folder named with a common word would then top
// every search containing that word, which the PRD names as the one anti-signal to
// watch for after real use.
//
// The value is measured, not guessed, because ts_rank's range is much narrower than it
// looks. Asked for the score of a single-term query against the same text repeated,
// Postgres gives:
//
//     occurrences   1        2         3         4         8         16
//     ts_rank       0.06079  0.07599   0.08275   0.08655   0.09286   0.09632
//
// It saturates just under 0.1, and a long note that mentions the term once scores
// exactly the same as a short one that does — 0.06079, the floor. So the entire spread
// available to a one-word query is 0.061 to 0.096, and a bonus of 0.1 would have put
// every folder match above every content match no matter how relevant. (It did: the
// first version of this constant was 0.1, and the ranking test caught it.)
//
// 0.08 sits inside that band, and says something specific: a folder- or tag-only match
// outranks a note that mentions your query once or twice in passing, and is outranked
// by a note that keeps coming back to it. A note matching both ways carries the bonus
// on top of its own content rank, so it always beats the same note matching one way —
// the other half of what §3 asks for.
//
// Multi-term queries can score above 0.1, since each term contributes; there the bonus
// is relatively smaller, which is the right direction — the more specific the query,
// the more the content match should be trusted.
const NAME_MATCH_BONUS = 0.08;

interface SearchRow {
  id: string;
  title: string;
  snippet: string;
  rank: number;
  updatedAt: Date;
  // Why this row is here. `matchedContent` false with a folder or tag set is the case
  // the whole "why did this match" requirement exists for: a note that says nothing
  // about your query, surfaced because of where it is filed.
  matchedContent: boolean;
  matchedFolderId: string | null;
  matchedTagIds: string[] | null;
}

// WHICH NOTES MATCH — defined once, for every query that needs to know.
//
// There are two of those now: the search itself, and the per-folder counts behind the
// scope selector. §6 of the PRD is blunt about what happens if the definition gets
// copied — "which notes are eligible at all (not deleted, not locked; archived is fine,
// trashed is not) currently lives in exactly one place, and must keep living in exactly
// one place." A second QUERY is fine. A second DEFINITION is not: the two would be free
// to disagree the next time either is edited, and the disagreement would surface as a
// count that does not match the list it is counting.
//
// So the pieces live here and the callers assemble them.
function matchPredicates(query: string, folderIds: string[], tagIds: string[]) {
  // Asked twice by the search — once to decide whether a note qualifies, once to report
  // whether content is the reason. Two copies would be two things free to disagree.
  const matchesContent = Prisma.sql`(
          (n."contentLanguage" = 'english' AND n."content_tsv" @@ websearch_to_tsquery('english', ${query}))
          OR
          (n."contentLanguage" = 'french' AND n."content_tsv" @@ websearch_to_tsquery('french', ${query}))
        )`;

  // EXISTS rather than a join to "NoteTag" on purpose. A join multiplies the row by the
  // number of matching tags, so a note carrying two matching tags would come back twice;
  // EXISTS asks the same question and answers it once.
  const matchesName = Prisma.sql`(
          n."folderId" = ANY(${folderIds}::text[])
          OR EXISTS (
            SELECT 1 FROM "NoteTag" nt
            WHERE nt."noteId" = n."id" AND nt."tagId" = ANY(${tagIds}::text[])
          )
        )`;

  // The whole gate. `isLocked = false` does more work here than it looks: a locked note's
  // tsvector is empty, so the content branch could never surface one anyway — but the
  // folder and tag branches never touch the tsvector, so a locked note filed in a
  // matching folder is kept out by this clause and by nothing else. Do not relax it.
  const eligible = Prisma.sql`n."deletedAt" IS NULL
        AND n."isLocked" = false
        AND (${matchesContent} OR ${matchesName})`;

  return { matchesContent, matchesName, eligible };
}

// Full-text search, run by Postgres rather than in application code.
//
// Notes carry a generated `content_tsv` column — Postgres derives it from the title
// and text automatically on every write, and a GIN index makes matching it fast. No
// separate search index to build, keep in sync, or rebuild after an import.
//
// LOCKED NOTES CAN NEVER MATCH, and not by filtering them out afterwards: the
// migration makes their tsvector empty, so there is nothing to match in the first
// place. That is the stronger guarantee — a future query that forgets a WHERE
// clause still cannot surface the contents of a locked note.
//
// That trick does NOT cover the folder and tag branches added below, and this is the
// one place it matters. Those branches never touch content_tsv, so an empty tsvector
// says nothing about them: a locked note filed in the Budget folder would match
// "budget" on its folder alone. The `isLocked = false` guard in the WHERE is what
// stops it, and for those two branches it is the only thing that does. Do not
// relax it.
//
// Archived notes DO remain searchable (archiving is "out of the way", not "gone");
// trashed ones do not.
//
// ── A note also matches by the name of its folder, or of one of its tags ───────
//
// You can find a note by how you filed it, not only by what it says — typing "budget"
// finds what is in the Budget folder even when the word appears nowhere in the note.
// That half cannot happen in the tsvector: `content_tsv` is a GENERATED column, and a
// generated column may not read any row but its own, so a folder's name is structurally
// out of its reach. It is answered in application code instead (lib/nameMatch.ts), and
// only the matched IDs arrive here, as an ordinary indexed lookup ORed into the same
// WHERE clause everything else already lives in.
//
// That last part is the rule, not a convenience: which notes are eligible at all —
// not trashed, not locked, archived is fine — is stated ONCE, below. A second query
// beside this one would be a second copy of those rules, free to disagree with this
// one the next time either is edited.
export async function searchRoutes(app: FastifyInstance) {
  app.get("/notes/search", async (request) => {
    const { q, limit, folderId, tagId } = searchQuery.parse(request.query);
    const query = q.trim();
    if (!query) return { results: [] };

    // Which folders and tags does this query name? Empty arrays when it names none,
    // or when it is too short to be allowed to (see MIN_NAME_QUERY_LENGTH) — in which
    // case the two branches below are simply false for every row and the query behaves
    // exactly as it did before this feature existed.
    const named = await matchFolderAndTagNames(query);
    const folderIds = named.folders.map((f) => f.id);
    const tagIds = named.tags.map((t) => t.id);

    // Composed once and used twice — in the WHERE to decide whether the note qualifies,
    // and in the SELECT to decide what that is worth. Writing it out twice would be two
    // things that have to stay identical, which is how a note gets ranked as a folder
    // match without being returned as one.
    //
    const { matchesContent, matchesName, eligible } = matchPredicates(query, folderIds, tagIds);

    // Narrowing to one folder or one tag. Written as fragments that are simply absent
    // when nothing is scoped, rather than as `(${folderId} IS NULL OR ...)` guards that
    // are always present and always true — the planner reads an extra AND on an indexed
    // column much better than it reads a disjunction it cannot prove anything about.
    //
    // This is still the same WHERE clause, and that matters: `deletedAt IS NULL` and
    // `isLocked = false` sit above it and apply to a scoped search exactly as they do to
    // an unscoped one. Which is what makes the privacy answer automatic — a folder that
    // contains only locked notes produces the same empty result as a folder that does
    // not exist, because both are just a WHERE that matched nothing.
    const inScope = Prisma.sql`
        ${folderId ? Prisma.sql`AND n."folderId" = ${folderId}` : Prisma.empty}
        ${tagId
          ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM "NoteTag" scoped
            WHERE scoped."noteId" = n."id" AND scoped."tagId" = ${tagId}
          )`
          : Prisma.empty}`;

    // websearch_to_tsquery parses the query the way a search engine would — quoted
    // phrases, OR, and a leading - to exclude — and, importantly, never throws on
    // malformed input the way plainto_tsquery's stricter cousins do. Users type
    // stray quotes and operators; the search should not 500 because of it.
    //
    // ts_headline builds the result snippet, wrapping the matched words in <mark>.
    // That is why the snippet crosses the wire as HTML — and why the client
    // sanitizes it on arrival anyway (see SearchPalette).
    //
    // ── Matching documents indexed in two different languages ─────────────────
    //
    // Each note's tsvector was built with its own configuration, so a single tsquery
    // cannot match them all: "verrouillée" stems one way under 'french' and another
    // under 'english', and a query parsed with the wrong one simply misses. The
    // matching and ranking clauses below therefore run BOTH configurations and OR
    // them, each branch paired with the language it belongs to.
    //
    // That shape is chosen for the index, not for readability. The obvious
    // alternative — `websearch_to_tsquery(n."contentLanguage"::regconfig, ${query})` —
    // is correct and shorter, and it builds a DIFFERENT tsquery for every row, which
    // means the GIN index on content_tsv cannot be used and every search becomes a
    // sequential scan over the whole table. It would have passed every correctness
    // test while quietly breaking the requirement that search not get slower. With two
    // constant tsqueries the planner can use the index for each branch and combine
    // them with a bitmap OR.
    //
    // ts_headline is exempt and DOES use the dynamic cast, because it runs over rows
    // the query has already selected — there is no index for it to miss, and taking
    // the note's own configuration is simply the correct way to segment its snippet.
    const rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT
        n."id",
        n."title",
        ts_headline(
          n."contentLanguage"::regconfig,
          n."title" || ' ' || coalesce(
            (SELECT string_agg(elem #>> '{}', ' ')
             FROM jsonb_path_query(n."content", 'strict $.**.text') AS elem), ''),
          websearch_to_tsquery(n."contentLanguage"::regconfig, ${query}),
          'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=20, MinWords=5'
        ) AS snippet,
        (
          CASE n."contentLanguage"
            WHEN 'french' THEN ts_rank(n."content_tsv", websearch_to_tsquery('french', ${query}))
            ELSE ts_rank(n."content_tsv", websearch_to_tsquery('english', ${query}))
          END
          + CASE WHEN ${matchesName} THEN ${NAME_MATCH_BONUS}::float8 ELSE 0 END
        ) AS rank,
        n."updatedAt",
        ${matchesContent} AS "matchedContent",
        CASE WHEN n."folderId" = ANY(${folderIds}::text[]) THEN n."folderId" END AS "matchedFolderId",
        (
          SELECT array_agg(nt."tagId")
          FROM "NoteTag" nt
          WHERE nt."noteId" = n."id" AND nt."tagId" = ANY(${tagIds}::text[])
        ) AS "matchedTagIds"
      FROM "Note" n
      WHERE ${eligible}
        ${inScope}
      ORDER BY rank DESC, n."updatedAt" DESC
      LIMIT ${limit}
    `;

    // Turn the ids the query gave back into the names the row will show. Both maps are
    // built from `named`, the same read that decided what matched, so the explanation
    // and the filter can never be sourced from two different moments.
    const folderById = new Map(named.folders.map((f) => [f.id, f]));

    return {
      results: rows.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet,
        updatedAt: r.updatedAt,
        matchedContent: r.matchedContent,
        matchedFolder: (r.matchedFolderId && folderById.get(r.matchedFolderId)) || null,
        // Ordered by walking `named.tags` — which nameMatch already sorted by name —
        // rather than by walking the row's own array. array_agg follows the order the
        // NoteTag rows happen to come back in, which is roughly the order the tags were
        // attached, so a row would list its reasons differently from its neighbour and
        // differently again after a re-tag. Taking the order from the one sorted list
        // makes it the same everywhere, for free.
        //
        // (array_agg also returns NULL rather than an empty array when nothing matched.)
        matchedTags: named.tags.filter((t) => (r.matchedTagIds ?? []).includes(t.id)),
      })),
    };
  });

  // How many notes would each folder, and each tag, give me for what I have typed?
  //
  // This is what puts a number beside every row in the scope selector, so choosing where
  // to look is a decision made with the answer visible rather than a guess followed by an
  // empty list. It is a separate request from the search itself for two reasons: the
  // search is scoped and these counts must not be — a count that already had your current
  // folder applied would just be the result count, repeated — and nothing needs them until
  // the selector is actually opened.
  //
  // The gate is `matchPredicates`, the same one the search runs. That is not tidiness: a
  // count computed from a second definition of "matches" would drift from the list it
  // labels, and the symptom — "it said 4, it showed 3" — is the kind of bug nobody can
  // reproduce on demand.
  app.get("/notes/search/facets", async (request) => {
    const { q } = searchFacetsQuery.parse(request.query);
    const query = q.trim();
    if (!query) return { total: 0, folders: [], tags: [] };

    const named = await matchFolderAndTagNames(query);
    const { eligible } = matchPredicates(
      query,
      named.folders.map((f) => f.id),
      named.tags.map((t) => t.id)
    );

    // Two aggregates rather than one clever query. Notes and tags are a many-to-many, so
    // the tag counts need the join and the folder counts must not have it — a note with
    // three tags would otherwise be counted three times towards its folder.
    const [folderRows, tagRows] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string | null; count: number }>>`
        SELECT n."folderId" AS id, count(*)::int AS count
        FROM "Note" n
        WHERE ${eligible}
        GROUP BY n."folderId"
      `,
      prisma.$queryRaw<Array<{ id: string; count: number }>>`
        SELECT tagged."tagId" AS id, count(*)::int AS count
        FROM "Note" n
        JOIN "NoteTag" tagged ON tagged."noteId" = n."id"
        WHERE ${eligible}
        GROUP BY tagged."tagId"
      `,
    ]);

    return {
      // Every matching note is in exactly one folder group — including the group for
      // notes with no folder at all, whose id is null — so the groups already sum to the
      // total and it does not need a third query.
      total: folderRows.reduce((sum, r) => sum + r.count, 0),
      folders: folderRows.filter((r): r is { id: string; count: number } => r.id !== null),
      tags: tagRows,
    };
  });

  // Title lookup, for the "link a note" picker and anything else that needs a
  // type-a-few-letters dropdown.
  //
  // ── Why this is not just /notes/search ───────────────────────────────────────
  //
  // The picker used to call full-text search, and it looked broken because full-text
  // search answers a different question. Postgres matches whole LEXEMES, so typing
  // "onboar" finds nothing even though a note is titled "Why our onboarding drops
  // off at step 3" — the match only appears once the word is finished. Worse,
  // English stop words are stripped from the query entirely, so "why" and "the"
  // match NOTHING AT ALL, no matter how many notes start with them. All measured
  // against the dev library, not assumed. That behaviour is right for a search page
  // (searching bodies, ranking by relevance) and wrong for a picker, where the user
  // is spelling out a title they already have in mind and expects the list to narrow
  // on every keystroke.
  //
  // So: a plain case-insensitive substring match on the title. No ranking, no
  // snippets, no stop words, and it narrows on the first letter.
  //
  // An empty query returns the most recently touched notes rather than nothing,
  // because the note you want to link is very often the one you were just in.
  //
  // Locked notes ARE included. Only their CONTENT is protected — the title is
  // stored in the clear and already shown on the card, in the sidebar and in every
  // list; the strong guarantee full-text search makes (an empty tsvector, so a
  // locked note cannot match on its contents even by accident) is untouched, since
  // nothing here reads content. Being unable to link to a locked note would be a
  // gap in the feature, not privacy.
  app.get("/notes/lookup", async (request) => {
    const { q, limit } = lookupQuery.parse(request.query);
    const query = q.trim();
    const notes = await prisma.note.findMany({
      where: {
        deletedAt: null,
        ...(query ? { title: { contains: query, mode: "insensitive" } } : {}),
      },
      select: { id: true, title: true, isLocked: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return { results: notes };
  });
}
