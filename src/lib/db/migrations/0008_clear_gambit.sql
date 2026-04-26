CREATE TABLE "linkage_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"linkage_id" uuid NOT NULL,
	"category" varchar(30) NOT NULL,
	"description" text,
	"estimated_amount" numeric(14, 2),
	"actual_amount" numeric(14, 2),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"port_name" varchar(255),
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linkages" ADD COLUMN "freight_deduct_address_commission" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "linkages" ADD COLUMN "freight_address_commission_pct" numeric(5, 2) DEFAULT '2.50' NOT NULL;--> statement-breakpoint
ALTER TABLE "linkages" ADD COLUMN "freight_deduct_brokerage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "linkages" ADD COLUMN "freight_brokerage_pct" numeric(5, 2) DEFAULT '1.25' NOT NULL;--> statement-breakpoint
ALTER TABLE "linkage_costs" ADD CONSTRAINT "linkage_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkage_costs" ADD CONSTRAINT "linkage_costs_linkage_id_linkages_id_fk" FOREIGN KEY ("linkage_id") REFERENCES "public"."linkages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linkage_costs" ADD CONSTRAINT "linkage_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "linkage_costs_linkage_idx" ON "linkage_costs" USING btree ("linkage_id");--> statement-breakpoint
CREATE INDEX "linkage_costs_tenant_linkage_idx" ON "linkage_costs" USING btree ("tenant_id","linkage_id");