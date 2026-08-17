import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { lookupQuery, searchQuery } from "../schemas.js";

interface SearchRow {
  id: string;
  title: string;
  snippet: string;
  rank: number;
  updatedAt: Date;
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
// Archived notes DO remain searchable (archiving is "out of the way", not "gone");
// trashed ones do not.
export async function searchRoutes(app: FastifyInstance) {
  app.get("/notes/search", async (request) => {
    const { q, limit } = searchQuery.parse(request.query);
    const query = q.trim();
    if (!query) return { results: [] };

    // websearch_to_tsquery parses the query the way a search engine would — quoted
    // phrases, OR, and a leading - to exclude — and, importantly, never throws on
    // malformed input the way plainto_tsquery's stricter cousins do. Users type
    // stray quotes and operators; the search should not 500 because of it.
    //
    // ts_headline builds the result snippet, wrapping the matched words in <mark>.
    // That is why the snippet crosses the wire as HTML — and why the client
    // sanitizes it on arrival anyway (see SearchPalette).
    const rows = await prisma.$queryRaw<SearchRow[]>`
      SELECT
        n."id",
        n."title",
        ts_headline(
          'english',
          n."title" || ' ' || coalesce(
            (SELECT string_agg(elem #>> '{}', ' ')
             FROM jsonb_path_query(n."content", 'strict $.**.text') AS elem), ''),
          websearch_to_tsquery('english', ${query}),
          'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=20, MinWords=5'
        ) AS snippet,
        ts_rank(n."content_tsv", websearch_to_tsquery('english', ${query})) AS rank,
        n."updatedAt"
      FROM "Note" n
      WHERE n."deletedAt" IS NULL
        AND n."isLocked" = false
        AND n."content_tsv" @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC, n."updatedAt" DESC
      LIMIT ${limit}
    `;

    return {
      results: rows.map((r) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet,
        updatedAt: r.updatedAt,
      })),
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
