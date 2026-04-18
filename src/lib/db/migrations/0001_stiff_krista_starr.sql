CREATE TYPE "public"."port_cost_type" AS ENUM('canal_toll', 'port_dues', 'agency', 'pilotage', 'other');--> statement-breakpoint
CREATE TABLE "port_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"port" varchar(120) NOT NULL,
	"year" integer NOT NULL,
	"cost_type" "port_cost_type" NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worldscale_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"load_port" varchar(120) NOT NULL,
	"discharge_port" varchar(120) NOT NULL,
	"year" integer NOT NULL,
	"flat_rate_usd_mt" numeric(12, 4) NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "port_costs" ADD CONSTRAINT "port_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_costs" ADD CONSTRAINT "port_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worldscale_rates" ADD CONSTRAINT "worldscale_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worldscale_rates" ADD CONSTRAINT "worldscale_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "port_costs_unique" ON "port_costs" USING btree ("tenant_id","port","year","cost_type");--> statement-breakpoint
CREATE INDEX "port_costs_port_idx" ON "port_costs" USING btree ("tenant_id","port");--> statement-breakpoint
CREATE UNIQUE INDEX "worldscale_rates_unique" ON "worldscale_rates" USING btree ("tenant_id","load_port","discharge_port","year");--> statement-breakpoint
CREATE INDEX "worldscale_rates_pair_idx" ON "worldscale_rates" USING btree ("tenant_id","load_port","discharge_port");