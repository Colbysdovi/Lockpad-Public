-- First-run onboarding state: one row, and the answer to "has this instance ever
-- been welcomed".
CREATE TABLE "AppState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "onboardedAt" TIMESTAMP(3),
    "seededAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("id")
);

-- Upgrade safety, and the whole reason this is a data migration rather than a check
-- the app performs at runtime.
--
-- An instance that already holds notes is somebody's real library. It must never see
-- a welcome wizard, and must never have three cheerful example notes injected into
-- it. Deciding that HERE means the answer is written once, at the moment the feature
-- arrives, while the evidence is still unambiguous: notes exist, therefore this
-- install predates onboarding, therefore it is already onboarded.
--
-- Left to runtime the same question gets re-asked on every boot, and only has to be
-- answered wrongly once — during a slow first query, an empty cache, a restore in
-- progress — to seed notes into a library that was never new.
--
-- COALESCE over MIN(createdAt): stamp the instance as onboarded at the moment its
-- oldest note was written rather than at migration time, so the timestamp reads as
-- "this library has existed since then" instead of implying a wizard ran today.
-- Both columns are stamped from the same evidence. `seededAt` matters as much as
-- `onboardedAt` here: it is what guarantees an existing library can never receive
-- starter notes, even if some future code path decides to seed without checking
-- whether the wizard already ran.
INSERT INTO "AppState" ("id", "onboardedAt", "seededAt", "updatedAt")
VALUES (
    1,
    (SELECT MIN("createdAt") FROM "Note"),
    (SELECT MIN("createdAt") FROM "Note"),
    CURRENT_TIMESTAMP
);
