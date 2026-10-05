BEGIN;

CREATE TYPE "webhook_delivery_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "webhook_endpoint_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event" VARCHAR(80) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_status" INTEGER,
    "last_error" VARCHAR(400),
    "next_attempt_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_deliveries_event_nonblank" CHECK ("event" ~ '[^[:space:]]'),
    CONSTRAINT "webhook_deliveries_body_nonblank" CHECK ("body" ~ '[^[:space:]]'),
    CONSTRAINT "webhook_deliveries_attempts_nonnegative" CHECK ("attempts" >= 0),
    CONSTRAINT "webhook_deliveries_pending_has_due_time" CHECK ("status" <> 'PENDING' OR "next_attempt_at" IS NOT NULL)
);

CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");
CREATE INDEX "webhook_deliveries_webhook_endpoint_id_created_at_id_idx" ON "webhook_deliveries"("webhook_endpoint_id", "created_at" DESC, "id");

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_endpoint_id_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
