-- Per-page note pins. `scope` identifies the list view ('all', 'folder:<id>',
-- 'tag:<id>'); a note may be pinned independently per scope.
CREATE TABLE "PinnedNote" (
    "noteId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinnedNote_pkey" PRIMARY KEY ("noteId", "scope")
);

-- CreateIndex
CREATE INDEX "PinnedNote_scope_pinnedAt_idx" ON "PinnedNote"("scope", "pinnedAt");

-- AddForeignKey
ALTER TABLE "PinnedNote" ADD CONSTRAINT "PinnedNote_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
