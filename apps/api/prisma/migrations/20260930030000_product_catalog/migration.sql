BEGIN;

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "unit" VARCHAR(32) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_sku_format" CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._-]*$'),
    CONSTRAINT "products_name_nonblank" CHECK ("name" ~ '[^[:space:]]'),
    CONSTRAINT "products_unit_nonblank" CHECK ("unit" ~ '[^[:space:]]')
);

CREATE INDEX "products_organization_id_archived_at_idx" ON "products"("organization_id", "archived_at");
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");
CREATE UNIQUE INDEX "products_organization_id_id_key" ON "products"("organization_id", "id");

ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;