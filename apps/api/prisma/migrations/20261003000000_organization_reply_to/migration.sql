BEGIN;

ALTER TABLE "organizations" ADD COLUMN "reply_to_email" VARCHAR(254);

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_reply_to_email_normalized" CHECK (
    "reply_to_email" IS NULL OR (
        "reply_to_email" <> '' AND "reply_to_email" = lower("reply_to_email")
        AND "reply_to_email" !~ '[[:space:]]' AND "reply_to_email" LIKE '%_@_%'
    )
);

COMMIT;
