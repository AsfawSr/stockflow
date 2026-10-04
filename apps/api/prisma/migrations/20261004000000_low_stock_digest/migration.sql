BEGIN;

ALTER TABLE "organizations" ADD COLUMN "last_digest_at" TIMESTAMPTZ(3);

COMMIT;
