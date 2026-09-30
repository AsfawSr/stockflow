BEGIN;

CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "contact_name" VARCHAR(120),
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "address" VARCHAR(500),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "suppliers_name_nonblank" CHECK ("name" ~ '[^[:space:]]'),
    CONSTRAINT "suppliers_contact_name_nonblank" CHECK ("contact_name" IS NULL OR "contact_name" ~ '[^[:space:]]'),
    CONSTRAINT "suppliers_email_normalized" CHECK (
        "email" IS NULL OR ("email" <> '' AND "email" = lower("email") AND "email" !~ '[[:space:]]')
    ),
    CONSTRAINT "suppliers_phone_format" CHECK (
        "phone" IS NULL OR ("phone" ~ '^[+0-9()./ -]{3,32}$' AND "phone" ~ '[0-9]')
    ),
    CONSTRAINT "suppliers_address_nonblank" CHECK ("address" IS NULL OR "address" ~ '[^[:space:]]')
);

CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" VARCHAR(500),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "locations_name_nonblank" CHECK ("name" ~ '[^[:space:]]'),
    CONSTRAINT "locations_address_nonblank" CHECK ("address" IS NULL OR "address" ~ '[^[:space:]]')
);

CREATE UNIQUE INDEX "suppliers_organization_id_name_key" ON "suppliers"("organization_id", "name");
CREATE UNIQUE INDEX "suppliers_organization_id_id_key" ON "suppliers"("organization_id", "id");
CREATE INDEX "suppliers_organization_id_archived_at_idx" ON "suppliers"("organization_id", "archived_at");
CREATE UNIQUE INDEX "locations_organization_id_name_key" ON "locations"("organization_id", "name");
CREATE UNIQUE INDEX "locations_organization_id_id_key" ON "locations"("organization_id", "id");
CREATE INDEX "locations_organization_id_archived_at_idx" ON "locations"("organization_id", "archived_at");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
