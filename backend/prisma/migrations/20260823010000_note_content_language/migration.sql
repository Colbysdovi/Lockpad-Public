-- Which text-search configuration each note is indexed with.
--
-- The value is a PostgreSQL configuration name ("english", "french") rather than an
-- interface locale, because the generated tsvector column branches on it directly.
-- Storing "fr" here would need a mapping in SQL and a matching mapping in TypeScript,
-- and two copies of a mapping is one more than can be kept in step.
--
-- DEFAULT 'english' is not a guess about content. It is what every existing note was
-- already being indexed with, so this column arrives describing the status quo exactly
-- and the schema change is a no-op until the backfill reclassifies them. A default of
-- NULL would have meant the generated column had to handle an absent language, which is
-- a branch that exists only during the minutes between this migration and the next.
ALTER TABLE "Note" ADD COLUMN "contentLanguage" TEXT NOT NULL DEFAULT 'english';

-- Only the two configurations the app can index with may ever be stored. Without this
-- a typo or a restored backup from a future version could put an unknown name in the
-- column, and the generated tsvector function would then silently take its ELSE branch
-- and index French text with English rules — wrong results, no error.
ALTER TABLE "Note" ADD CONSTRAINT "Note_contentLanguage_check"
    CHECK ("contentLanguage" IN ('english', 'french'));
