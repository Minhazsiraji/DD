CREATE TYPE "public"."priority_reason" AS ENUM('EMERGENCY', 'ELDERLY', 'CHILD', 'PREGNANT', 'DISABILITY', 'UNWELL_WAITING', 'DOCTOR_INSTRUCTION', 'STAFF_OR_FAMILY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."queue_event_type" AS ENUM('CALLED', 'SKIPPED', 'RECALLED', 'PRIORITY_SET', 'PRIORITY_CLEARED');--> statement-breakpoint
CREATE TABLE "queue_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"called_at" timestamp with time zone,
	"call_count" integer DEFAULT 0 NOT NULL,
	"skipped_at" timestamp with time zone,
	"skip_count" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"priority_reason" "priority_reason",
	"priority_note" text,
	"priority_set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"event_type" "queue_event_type" NOT NULL,
	"reason" "priority_reason",
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"seq" bigserial NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_priority_set_by_profiles_id_fk" FOREIGN KEY ("priority_set_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "queue_entries_appointment_key" ON "queue_entries" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "queue_entries_session_idx" ON "queue_entries" USING btree ("practice_location_id","session_date");--> statement-breakpoint
CREATE INDEX "queue_events_appointment_idx" ON "queue_events" USING btree ("appointment_id","seq");