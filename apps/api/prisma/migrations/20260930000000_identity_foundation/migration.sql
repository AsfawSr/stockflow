BEGIN;

CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "organization_role" AS ENUM ('ADMIN', 'PURCHASER', 'MANAGER', 'WAREHOUSE');

CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organizations_name_nonblank" CHECK ("name" ~ '[^[:space:]]'),
    CONSTRAINT "organizations_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_normalized" CHECK (
        "email" <> '' AND "email" = lower("email") AND "email" !~ '[[:space:]]'
    ),
    CONSTRAINT "users_display_name_nonblank" CHECK ("display_name" ~ '[^[:space:]]')
);

CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "roles" "organization_role"[] NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "memberships_roles_valid_set" CHECK (
        cardinality("roles") BETWEEN 1 AND 4
        AND array_ndims("roles") = 1
        AND array_lower("roles", 1) = 1
        AND array_position("roles", NULL) IS NULL
        AND cardinality("roles") = (
            ('ADMIN' = ANY("roles"))::int
            + ('PURCHASER' = ANY("roles"))::int
            + ('MANAGER' = ANY("roles"))::int
            + ('WAREHOUSE' = ANY("roles"))::int
        )
    )
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;