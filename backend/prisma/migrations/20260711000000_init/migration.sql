-- Lockpad initial migration.
-- Tables mirror prisma/schema.prisma. The tsvector generated column and its
-- extraction function are hand-authored here (Prisma can't express them).

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentFolderId" TEXT,
    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "folderId" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "encryptedContent" BYTEA,
    "cryptoMeta" JSONB,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoteTag" (
    "noteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "NoteTag_pkey" PRIMARY KEY ("noteId","tagId")
);

CREATE TABLE "NoteLink" (
    "sourceNoteId" TEXT NOT NULL,
    "targetNoteId" TEXT NOT NULL,
    CONSTRAINT "NoteLink_pkey" PRIMARY KEY ("sourceNoteId","targetNoteId")
);

-- ── Indexes & unique constraints ─────────────────────────────────────────────

CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");
CREATE INDEX "Note_deletedAt_archivedAt_updatedAt_id_idx" ON "Note"("deletedAt","archivedAt","updatedAt","id");
CREATE INDEX "Note_folderId_idx" ON "Note"("folderId");

-- ── Foreign keys ─────────────────────────────────────────────────────────────

ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentFolderId_fkey"
    FOREIGN KEY ("parentFolderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_sourceNoteId_fkey"
    FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_targetNoteId_fkey"
    FOREIGN KEY ("targetNoteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Full-text search ─────────────────────────────────────────────────────────
-- Immutable extractor: pulls every "text" string value out of the TipTap JSON
-- document (recursive `$.**.text` jsonpath) and concatenates it. Returns an
-- EMPTY tsvector for locked notes so their content is never indexed/searchable.
CREATE OR REPLACE FUNCTION lockpad_note_tsv(p_title text, p_content jsonb, p_is_locked boolean)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_is_locked THEN to_tsvector('english', '')
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

ALTER TABLE "Note"
    ADD COLUMN "content_tsv" tsvector
    GENERATED ALWAYS AS (lockpad_note_tsv("title", "content", "isLocked")) STORED;

CREATE INDEX "Note_content_tsv_idx" ON "Note" USING GIN ("content_tsv");
