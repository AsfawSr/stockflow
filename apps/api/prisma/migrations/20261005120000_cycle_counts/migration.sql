BEGIN;

CREATE TYPE "cycle_count_status" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

CREATE TABLE "cycle_counts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "status" "cycle_count_status" NOT NULL DEFAULT 'OPEN',
    "note" VARCHAR(500),
    "created_by" UUID,
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cycle_counts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cycle_counts_note_nonblank" CHECK ("note" IS NULL OR "note" ~ '[^[:space:]]'),
    CONSTRAINT "cycle_counts_completed_has_time" CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL)
);

CREATE INDEX "cycle_counts_organization_id_created_at_id_idx" ON "cycle_counts"("organization_id", "created_at" DESC, "id");

CREATE TABLE "cycle_count_lines" (
    "id" UUID NOT NULL,
    "cycle_count_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "counted_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cycle_count_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cycle_count_lines_expected_nonnegative" CHECK ("expected_quantity" >= 0),
    CONSTRAINT "cycle_count_lines_counted_nonnegative" CHECK ("counted_quantity" >= 0)
);

CREATE UNIQUE INDEX "cycle_count_lines_cycle_count_id_product_id_key" ON "cycle_count_lines"("cycle_count_id", "product_id");
CREATE INDEX "cycle_count_lines_organization_id_idx" ON "cycle_count_lines"("organization_id");

ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_cycle_count_id_fkey" FOREIGN KEY ("cycle_count_id") REFERENCES "cycle_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cycle_count_lines" ADD CONSTRAINT "cycle_count_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
