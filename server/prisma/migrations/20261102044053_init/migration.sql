-- Hand-added: trigram support for the search_text GIN index below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ANALYST');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('job_completed', 'job_failed', 'payment_succeeded', 'payment_failed', 'user_invited', 'workflow_delayed');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "event_type" "EventType" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "metadata" JSONB NOT NULL,
    "search_text" TEXT NOT NULL,
    "idempotency_key" VARCHAR(255),
    "request_hash" CHAR(64),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    -- Hand-added: defence in depth for the API's "metadata must be an object" rule.
    CONSTRAINT "events_metadata_is_object" CHECK (jsonb_typeof("metadata") = 'object')
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_org_id_idx" ON "users"("org_id");

-- CreateIndex
CREATE INDEX "events_org_occurred_idx" ON "events"("org_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "events_org_type_occurred_idx" ON "events"("org_id", "event_type", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "events_org_source_occurred_idx" ON "events"("org_id", "source", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "events_search_text_trgm_idx" ON "events" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "events_org_idempotency_key_uq" ON "events"("org_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
