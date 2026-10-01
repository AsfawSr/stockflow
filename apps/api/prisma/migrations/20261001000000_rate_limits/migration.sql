BEGIN;

CREATE TABLE "rate_limits" (
    "key" VARCHAR(128) NOT NULL,
    "hits" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "rate_limits_hits_positive" CHECK ("hits" >= 1)
);

CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits"("expires_at");

COMMIT;
