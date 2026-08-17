-- Session revocation: records only what has been taken away, never what was issued.
CREATE TABLE "RevokedSession" (
    "jti" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("jti")
);

-- Single-row table: "everything issued before this moment is refused, except one".
CREATE TABLE "SessionEpoch" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "exemptJti" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionEpoch_pkey" PRIMARY KEY ("id")
);
