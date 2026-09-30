BEGIN;

ALTER TABLE "products" ADD COLUMN "reorder_point" INTEGER;
ALTER TABLE "products" ADD CONSTRAINT "products_reorder_point_range"
    CHECK ("reorder_point" IS NULL OR ("reorder_point" >= 0 AND "reorder_point" <= 1000000));

COMMIT;
