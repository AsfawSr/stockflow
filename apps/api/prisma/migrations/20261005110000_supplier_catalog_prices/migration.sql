BEGIN;

CREATE TABLE "supplier_catalog_prices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_catalog_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_catalog_prices_price_positive" CHECK ("unit_price" > 0)
);

CREATE UNIQUE INDEX "supplier_catalog_prices_supplier_id_product_id_key" ON "supplier_catalog_prices"("supplier_id", "product_id");
CREATE INDEX "supplier_catalog_prices_organization_id_idx" ON "supplier_catalog_prices"("organization_id");
CREATE INDEX "supplier_catalog_prices_product_id_idx" ON "supplier_catalog_prices"("product_id");

ALTER TABLE "supplier_catalog_prices" ADD CONSTRAINT "supplier_catalog_prices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_catalog_prices" ADD CONSTRAINT "supplier_catalog_prices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_catalog_prices" ADD CONSTRAINT "supplier_catalog_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
