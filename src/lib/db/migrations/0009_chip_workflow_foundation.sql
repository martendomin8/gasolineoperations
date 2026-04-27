-- Phase 1 foundation for Lauri-style chip workflow.
--
-- Two changes:
--   1. "counterparty" added to party_type enum so chips that target the
--      buyer/seller (e.g. "VAT + transport request to buyer") have a
--      proper recipient label distinct from terminal/agent/inspector/broker.
--   2. documents table is widened with AI-parser metadata: mime_type,
--      size_bytes, parsed_data (jsonb), parser_confidence,
--      parser_classifier_label, parser_classifier_confidence, updated_at.
--      Plus a file_type index because the Documents tab groups by type.
--
-- A short-lived "linkage_documents" table existed between drafts of this
-- migration; it duplicated the existing documents table and is dropped
-- here in case any partial schema push created it.

ALTER TYPE "public"."party_type" ADD VALUE IF NOT EXISTS 'counterparty';
--> statement-breakpoint

DROP TABLE IF EXISTS "linkage_documents";
--> statement-breakpoint

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "mime_type" varchar(100);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "size_bytes" integer;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parsed_data" jsonb;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parser_confidence" numeric(3, 2);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parser_classifier_label" varchar(40);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parser_classifier_confidence" numeric(3, 2);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "documents_file_type_idx" ON "documents" USING btree ("file_type");
