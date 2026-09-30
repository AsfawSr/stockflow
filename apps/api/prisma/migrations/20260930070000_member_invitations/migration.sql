BEGIN;

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "roles" "organization_role"[] NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_email_normalized" CHECK (
        "email" <> '' AND "email" = lower("email") AND "email" !~ '[[:space:]]'
    ),
    CONSTRAINT "invitations_hash_format" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "invitations_expiry" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "invitations_roles_valid_set" CHECK (
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

CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE UNIQUE INDEX "invitations_organization_id_email_key" ON "invitations"("organization_id", "email");
CREATE INDEX "invitations_expires_at_idx" ON "invitations"("expires_at");

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
