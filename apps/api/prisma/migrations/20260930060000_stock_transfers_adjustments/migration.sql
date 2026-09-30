-- New enum values must commit before constraints can reference them.
ALTER TYPE "stock_movement_type" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "stock_movement_type" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "stock_movement_type" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';

BEGIN;

CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "from_location_id" UUID NOT NULL,
    "to_location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_transfers_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "stock_transfers_distinct_locations" CHECK ("from_location_id" <> "to_location_id"),
    CONSTRAINT "stock_transfers_note_nonblank" CHECK ("note" IS NULL OR "note" ~ '[^[:space:]]')
);

CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_adjustments_quantity_nonzero" CHECK ("quantity" <> 0),
    CONSTRAINT "stock_adjustments_reason_nonblank" CHECK ("reason" ~ '[^[:space:]]')
);

CREATE INDEX "stock_transfers_organization_id_created_at_idx" ON "stock_transfers"("organization_id", "created_at");
CREATE INDEX "stock_adjustments_organization_id_created_at_idx" ON "stock_adjustments"("organization_id", "created_at");
CREATE INDEX "stock_movements_organization_id_created_at_idx" ON "stock_movements"("organization_id", "created_at");

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_product_id_fkey"
    FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_from_location_id_fkey"
    FOREIGN KEY ("organization_id", "from_location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_to_location_id_fkey"
    FOREIGN KEY ("organization_id", "to_location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_organization_id_product_id_fkey"
    FOREIGN KEY ("organization_id", "product_id") REFERENCES "products"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_organization_id_location_id_fkey"
    FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD COLUMN "stock_transfer_id" UUID;
ALTER TABLE "stock_movements" ADD COLUMN "stock_adjustment_id" UUID;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_transfer_id_fkey"
    FOREIGN KEY ("stock_transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_adjustment_id_fkey"
    FOREIGN KEY ("stock_adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "stock_movements_stock_adjustment_id_key" ON "stock_movements"("stock_adjustment_id");
-- One outbound and one inbound movement per transfer.
CREATE UNIQUE INDEX "stock_movements_transfer_direction_key"
    ON "stock_movements"("stock_transfer_id", "type") WHERE "stock_transfer_id" IS NOT NULL;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_shape" CHECK (
    (("type" IN ('TRANSFER_IN', 'TRANSFER_OUT')) = ("stock_transfer_id" IS NOT NULL))
    AND ("type" <> 'TRANSFER_OUT' OR "quantity" < 0)
    AND ("type" <> 'TRANSFER_IN' OR "quantity" > 0)
);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjustment_shape" CHECK (
    ("type" = 'ADJUSTMENT') = ("stock_adjustment_id" IS NOT NULL)
);

COMMIT;
