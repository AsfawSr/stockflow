BEGIN;
CREATE TYPE "account_token_purpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');
ALTER TABLE "sessions" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "email_verified_at" TIMESTAMPTZ(3);
CREATE TABLE "account_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "purpose" "account_token_purpose" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_tokens_hash_format" CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "account_tokens_expiry" CHECK ("expires_at" > "created_at")
);
CREATE UNIQUE INDEX "account_tokens_token_hash_key" ON "account_tokens"("token_hash");
CREATE INDEX "account_tokens_user_id_purpose_idx" ON "account_tokens"("user_id", "purpose");
CREATE INDEX "account_tokens_expires_at_idx" ON "account_tokens"("expires_at");
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;