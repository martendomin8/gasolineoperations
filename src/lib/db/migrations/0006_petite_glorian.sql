CREATE TABLE "deal_parcels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"parcel_no" integer NOT NULL,
	"product" varchar(255) NOT NULL,
	"quantity_mt" numeric(12, 3) NOT NULL,
	"contracted_qty" varchar(100),
	"nominated_qty" numeric(12, 3),
	"loaded_qty" numeric(12, 3),
	"bl_figure" varchar(100),
	"bl_date" date,
	"pricing_finalized_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "parcel_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_parcels" ADD CONSTRAINT "deal_parcels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_parcels" ADD CONSTRAINT "deal_parcels_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_parcels_deal_parcel_no_idx" ON "deal_parcels" USING btree ("deal_id","parcel_no");--> statement-breakpoint
CREATE INDEX "deal_parcels_tenant_deal_idx" ON "deal_parcels" USING btree ("tenant_id","deal_id");--> statement-breakpoint
-- Backfill: every pre-existing deal becomes a single-parcel deal with one
-- mirroring row in deal_parcels. The deal-level columns (product,
-- quantity_mt, contracted_qty, nominated_qty, loaded_quantity_mt) stay in
-- place as the denormalised "primary parcel" view used by dashboards.
INSERT INTO "deal_parcels" (
  "tenant_id",
  "deal_id",
  "parcel_no",
  "product",
  "quantity_mt",
  "contracted_qty",
  "nominated_qty",
  "loaded_qty"
)
SELECT
  "tenant_id",
  "id",
  1,
  "product",
  "quantity_mt",
  "contracted_qty",
  "nominated_qty",
  "loaded_quantity_mt"
FROM "deals";