ALTER TABLE "deals" ADD COLUMN "arrival_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "arrival_is_actual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "departure_override" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "linkages" ADD COLUMN "cp_speed_kn" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "linkages" ADD COLUMN "cp_speed_source" varchar(20);