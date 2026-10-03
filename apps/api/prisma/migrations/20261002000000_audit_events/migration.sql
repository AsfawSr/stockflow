BEGIN;

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID,
    "summary" VARCHAR(400) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_events_action_nonblank" CHECK ("action" ~ '[^[:space:]]'),
    CONSTRAINT "audit_events_entity_type_nonblank" CHECK ("entity_type" ~ '[^[:space:]]'),
    CONSTRAINT "audit_events_summary_nonblank" CHECK ("summary" ~ '[^[:space:]]')
);

CREATE INDEX "audit_events_organization_id_created_at_id_idx" ON "audit_events"("organization_id", "created_at" DESC, "id");

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
