-- Images embedded in a note's body. Bytes are stored in Postgres (bytea) rather
-- than on a disk volume: a self-hoster's `pg_dump` then already contains their
-- pictures, and a note's images are removed in the same transaction as the note.
-- Deleting a note cascades here; the API caps the size of any single upload.
CREATE TABLE "NoteImage" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteImage_pkey" PRIMARY KEY ("id")
);

-- Every lookup is "the images belonging to this note" (rendering, cleanup, lock).
CREATE INDEX "NoteImage_noteId_idx" ON "NoteImage"("noteId");

-- AddForeignKey
ALTER TABLE "NoteImage" ADD CONSTRAINT "NoteImage_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
