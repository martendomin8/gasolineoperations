CREATE TABLE "ais_prediction_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mmsi" varchar(15) NOT NULL,
	"predicted_lat" numeric(10, 7) NOT NULL,
	"predicted_lon" numeric(10, 7) NOT NULL,
	"actual_lat" numeric(10, 7) NOT NULL,
	"actual_lon" numeric(10, 7) NOT NULL,
	"delta_nm" numeric(7, 2) NOT NULL,
	"mode" varchar(20) NOT NULL,
	"ais_gap_seconds" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vessel_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mmsi" varchar(15) NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lon" numeric(10, 7) NOT NULL,
	"cog" numeric(5, 2),
	"sog" numeric(5, 2),
	"heading" integer,
	"nav_status" integer,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vessels" (
	"mmsi" varchar(15) PRIMARY KEY NOT NULL,
	"imo" varchar(20),
	"name" varchar(120),
	"call_sign" varchar(20),
	"ship_type" integer,
	"length_m" integer,
	"beam_m" integer,
	"draught_m" numeric(4, 1),
	"destination" varchar(120),
	"eta" timestamp with time zone,
	"static_updated_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linkages" ADD COLUMN "vessel_mmsi" varchar(15);--> statement-breakpoint
CREATE INDEX "ais_corrections_mmsi_idx" ON "ais_prediction_corrections" USING btree ("mmsi","recorded_at");--> statement-breakpoint
CREATE INDEX "vessel_positions_mmsi_received_idx" ON "vessel_positions" USING btree ("mmsi","received_at");--> statement-breakpoint
CREATE INDEX "vessel_positions_received_idx" ON "vessel_positions" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "vessels_imo_idx" ON "vessels" USING btree ("imo");