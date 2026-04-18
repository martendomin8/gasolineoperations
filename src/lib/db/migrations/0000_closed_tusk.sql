CREATE TYPE "public"."deal_direction" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."deal_incoterm" AS ENUM('FOB', 'CIF', 'CFR', 'DAP');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('draft', 'active', 'loading', 'sailing', 'discharging', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."email_draft_status" AS ENUM('draft', 'reviewed', 'sent');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('terminal', 'agent', 'inspector', 'broker');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('operator', 'trader', 'admin');--> statement-breakpoint
CREATE TYPE "public"."workflow_step_status" AS ENUM('pending', 'blocked', 'ready', 'draft_generated', 'sent', 'acknowledged', 'needs_update', 'received', 'done', 'na', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_step_type" AS ENUM('nomination', 'instruction', 'order', 'appointment');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"field_changed" varchar(100) NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" uuid NOT NULL,
	"affected_steps" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" "deal_direction" NOT NULL,
	"counterparty" varchar(255) NOT NULL,
	"incoterm" "deal_incoterm",
	"loadport" varchar(255),
	"discharge_port" varchar(255),
	"quantity_mt" numeric(12, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_ref" varchar(100),
	"linkage_code" varchar(100),
	"linkage_id" uuid,
	"deal_type" varchar(50) DEFAULT 'regular' NOT NULL,
	"counterparty" varchar(255) NOT NULL,
	"direction" "deal_direction" NOT NULL,
	"product" varchar(255) NOT NULL,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"contracted_qty" varchar(100),
	"nominated_qty" numeric(12, 3),
	"incoterm" "deal_incoterm" NOT NULL,
	"loadport" varchar(255) NOT NULL,
	"discharge_port" varchar(255),
	"laycan_start" date NOT NULL,
	"laycan_end" date NOT NULL,
	"vessel_name" varchar(255),
	"vessel_imo" varchar(20),
	"vessel_cleared" boolean DEFAULT false NOT NULL,
	"doc_instructions_received" boolean DEFAULT false NOT NULL,
	"status" "deal_status" DEFAULT 'draft' NOT NULL,
	"assigned_operator_id" uuid,
	"secondary_operator_id" uuid,
	"created_by" uuid NOT NULL,
	"source_raw_text" text,
	"pricing_formula" text,
	"pricing_type" varchar(20),
	"pricing_estimated_date" date,
	"loaded_quantity_mt" numeric(12, 3),
	"pricing_period_type" varchar(20),
	"pricing_period_value" varchar(100),
	"pricing_confirmed" boolean DEFAULT false NOT NULL,
	"estimated_bl_nor_date" date,
	"special_instructions" text,
	"excel_statuses" jsonb DEFAULT '{}'::jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid,
	"linkage_id" uuid,
	"filename" varchar(255) NOT NULL,
	"file_type" varchar(50) NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_step_id" uuid NOT NULL,
	"template_id" uuid,
	"to_addresses" text NOT NULL,
	"cc_addresses" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"merge_fields_used" jsonb DEFAULT '{}'::jsonb,
	"status" "email_draft_status" DEFAULT 'draft' NOT NULL,
	"sedna_message_id" varchar(255),
	"sent_via_sedna_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"party_type" "party_type" NOT NULL,
	"terminal_id" uuid,
	"incoterm" "deal_incoterm",
	"region" varchar(100),
	"subject_template" text NOT NULL,
	"body_template" text NOT NULL,
	"merge_fields" jsonb DEFAULT '[]'::jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linkage_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"linkage_id" uuid NOT NULL,
	"step_name" varchar(255) NOT NULL,
	"step_type" varchar(50) NOT NULL,
	"recipient_party_type" varchar(50),
	"description" text,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"step_order" integer DEFAULT 0 NOT NULL,
	"assigned_party_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linkages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"linkage_number" varchar(100),
	"temp_name" varchar(100) NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"vessel_name" varchar(255),
	"vessel_imo" varchar(20),
	"vessel_particulars" jsonb,
	"assigned_operator_id" uuid,
	"secondary_operator_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "party_type" NOT NULL,
	"name" varchar(255) NOT NULL,
	"port" varchar(255),
	"region_tags" text[] DEFAULT '{}',
	"email" varchar(255),
	"phone" varchar(100),
	"notes" text,
	"is_fixed" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'operator' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"step_name" varchar(255) NOT NULL,
	"description" text,
	"step_type" "workflow_step_type" NOT NULL,
	"recipient_party_type" "party_type" NOT NULL,
	"is_external_wait" boolean DEFAULT false NOT NULL,
	"status" "workflow_step_status" DEFAULT 'pending' NOT NULL,
	"blocked_by" uuid,
	"recommended_after" uuid,
	"email_template_id" uuid,
	"email_draft_id" uuid,
	"assigned_party_id" uuid,
	"due_date" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"incoterm" "deal_incoterm",
	"direction" "deal_direction",
	"region_pattern" varchar(100),
	"steps" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_change_logs" ADD CONSTRAINT "deal_change_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_change_logs" ADD CONSTRAINT "deal_change_logs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_change_logs" ADD CONSTRAINT "deal_change_logs_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_legs" ADD CONSTRAINT "deal_legs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_legs" ADD CONSTRAINT "deal_legs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_linkage_id_linkages_id_fk" FOREIGN KEY ("linkage_id") REFERENCES "public"."linkages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_assigned_operator_id_users_id_fk" FOREIGN KEY ("assigned_operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_secondary_operator_id_users_id_fk" FOREIGN KEY ("secondary_operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_linkage_id_linkages_id_fk" FOREIGN KEY ("linkage_id") REFERENCES "public"."linkages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_terminal_id_parties_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkage_steps" ADD CONSTRAINT "linkage_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkage_steps" ADD CONSTRAINT "linkage_steps_linkage_id_linkages_id_fk" FOREIGN KEY ("linkage_id") REFERENCES "public"."linkages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkage_steps" ADD CONSTRAINT "linkage_steps_assigned_party_id_parties_id_fk" FOREIGN KEY ("assigned_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkages" ADD CONSTRAINT "linkages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkages" ADD CONSTRAINT "linkages_assigned_operator_id_users_id_fk" FOREIGN KEY ("assigned_operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkages" ADD CONSTRAINT "linkages_secondary_operator_id_users_id_fk" FOREIGN KEY ("secondary_operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_blocked_by_workflow_steps_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."workflow_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_recommended_after_workflow_steps_id_fk" FOREIGN KEY ("recommended_after") REFERENCES "public"."workflow_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_assigned_party_id_parties_id_fk" FOREIGN KEY ("assigned_party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_deal_idx" ON "audit_logs" USING btree ("tenant_id","deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_change_logs_deal_idx" ON "deal_change_logs" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deals_tenant_status_idx" ON "deals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "deals_tenant_dedup_idx" ON "deals" USING btree ("tenant_id","counterparty","direction","laycan_start");--> statement-breakpoint
CREATE INDEX "deals_tenant_linkage_idx" ON "deals" USING btree ("tenant_id","linkage_code");--> statement-breakpoint
CREATE INDEX "documents_deal_idx" ON "documents" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "documents_linkage_idx" ON "documents" USING btree ("linkage_id");--> statement-breakpoint
CREATE INDEX "linkage_steps_linkage_idx" ON "linkage_steps" USING btree ("linkage_id");--> statement-breakpoint
CREATE INDEX "linkage_steps_tenant_idx" ON "linkage_steps" USING btree ("tenant_id","linkage_id");--> statement-breakpoint
CREATE INDEX "linkages_tenant_status_idx" ON "linkages" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "linkages_tenant_linkage_number_idx" ON "linkages" USING btree ("tenant_id","linkage_number");--> statement-breakpoint
CREATE INDEX "parties_tenant_type_idx" ON "parties" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_idx" ON "users" USING btree ("tenant_id","email");