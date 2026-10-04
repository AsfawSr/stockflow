BEGIN;

ALTER TABLE "organizations" ADD COLUMN "archived_at" TIMESTAMPTZ(3);

COMMIT;
