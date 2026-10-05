BEGIN;

CREATE TABLE "report_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_snapshots_type_known" CHECK ("type" IN ('valuation'))
);

CREATE INDEX "report_snapshots_organization_id_created_at_id_idx" ON "report_snapshots"("organization_id", "created_at" DESC, "id");

ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
