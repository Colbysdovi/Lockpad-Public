-- Optional per-note color. Stores one of the fixed note-color keys (see
-- schemas.ts `noteColor`), or NULL for "no color". A plain nullable text column;
-- validation of the allowed values happens at the API layer.
ALTER TABLE "Note" ADD COLUMN "color" TEXT;
