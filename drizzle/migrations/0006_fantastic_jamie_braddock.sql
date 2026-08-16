CREATE TABLE "appointment_token_counters" (
	"practice_location_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"last_token" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_token_counters_practice_location_id_session_date_pk" PRIMARY KEY("practice_location_id","session_date")
);
--> statement-breakpoint
ALTER TABLE "appointment_events" DROP CONSTRAINT "appointment_events_appointment_id_appointments_id_fk";
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_owner_doctor_id_doctor_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_patient_id_patients_id_fk";
--> statement-breakpoint
DROP INDEX "appointments_location_date_idx";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "session_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_token_counters" ADD CONSTRAINT "appointment_token_counters_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_location_session_idx" ON "appointments" USING btree ("practice_location_id","session_date");