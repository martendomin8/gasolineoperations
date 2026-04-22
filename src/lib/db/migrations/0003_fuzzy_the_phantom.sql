CREATE TABLE "ais_validation_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mmsi" varchar(15) NOT NULL,
	"layer" varchar(20) NOT NULL,
	"flag_type" varchar(50) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"details" jsonb,
	"message_received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"acknowledged_action" varchar(30)
);
--> statement-breakpoint
ALTER TABLE "ais_validation_flags" ADD CONSTRAINT "ais_validation_flags_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ais_flags_mmsi_created_idx" ON "ais_validation_flags" USING btree ("mmsi","created_at");--> statement-breakpoint
CREATE INDEX "ais_flags_unresolved_idx" ON "ais_validation_flags" USING btree ("mmsi") WHERE acknowledged_at IS NULL;