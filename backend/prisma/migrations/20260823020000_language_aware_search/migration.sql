-- Index each note with the text-search rules of the language it is actually written
-- in, instead of English regardless.
--
-- ── Why the function takes the language rather than looking it up ────────────
--
-- The column below is GENERATED ... STORED, which requires an IMMUTABLE expression.
-- `to_tsvector(regconfig, text)` is immutable; the two-argument form that takes the
-- configuration NAME as text is only STABLE, because the name is resolved against
-- the catalogue at run time. So the configuration cannot be a variable — it has to be
-- a literal in each branch of a CASE, and the branch is chosen by an argument.
--
-- That is also what makes index and language impossible to disagree. The tsvector is
-- derived from "contentLanguage" as a column of the same row, so both describe one
-- row state by construction rather than by two pieces of code remembering to agree.
CREATE OR REPLACE FUNCTION lockpad_note_tsv(
    p_title text,
    p_content jsonb,
    p_is_locked boolean,
    p_language text
)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        -- Locked notes index to an EMPTY tsvector, exactly as before. The server holds
        -- only ciphertext for them and they have never been searchable; nothing about
        -- language changes that, and this branch is what keeps it true.
        WHEN p_is_locked THEN to_tsvector('english', '')
        WHEN p_language = 'french' THEN to_tsvector('french',
            coalesce(p_title, '') || ' ' ||
            coalesce(
                (SELECT string_agg(elem #>> '{}', ' ')
                 FROM jsonb_path_query(p_content, 'strict $.**.text') AS elem),
                ''
            )
        )
        ELSE to_tsvector('english',
            coalesce(p_title, '') || ' ' ||
            coalesce(
                (SELECT string_agg(elem #>> '{}', ' ')
                 FROM jsonb_path_query(p_content, 'strict $.**.text') AS elem),
                ''
            )
        )
    END
$$;

-- A stored generated column's expression cannot be altered in place, so the column is
-- dropped and rebuilt. Rebuilding it is also the backfill the PRD asks for: ADD COLUMN
-- ... GENERATED ALWAYS AS ... STORED computes the value for EVERY existing row as part
-- of the same statement. No separate reindex pass, and no window in which some notes
-- are indexed one way and some another.
--
-- Dropping the column drops its index with it, so the index is recreated below.
ALTER TABLE "Note" DROP COLUMN "content_tsv";

ALTER TABLE "Note"
    ADD COLUMN "content_tsv" tsvector
    GENERATED ALWAYS AS (lockpad_note_tsv("title", "content", "isLocked", "contentLanguage")) STORED;

CREATE INDEX "Note_content_tsv_idx" ON "Note" USING GIN ("content_tsv");

-- The three-argument version is now unreferenced. Dropped explicitly rather than left
-- behind: two functions of the same name, one of which indexes everything as English,
-- is exactly the kind of leftover that gets called by a future migration written from
-- memory.
DROP FUNCTION IF EXISTS lockpad_note_tsv(text, jsonb, boolean);

-- Existing notes still carry the 'english' default from the previous migration, which
-- is what they were already indexed with — so this migration changes nothing for them
-- until they are classified. That classification needs the language detector, which is
-- application code and cannot run here; it is done once on startup and recorded on
-- AppState so it never runs twice.
ALTER TABLE "AppState" ADD COLUMN "notesClassifiedAt" TIMESTAMP(3);
