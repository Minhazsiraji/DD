CREATE TYPE "public"."diagnosis_certainty" AS ENUM('PROVISIONAL', 'WORKING', 'CONFIRMED', 'RULED_OUT');--> statement-breakpoint
CREATE TYPE "public"."encounter_event_type" AS ENUM('CREATED', 'SECTIONS_UPDATED', 'VITALS_UPDATED', 'DIAGNOSIS_ADDED', 'DIAGNOSIS_UPDATED', 'DIAGNOSIS_REMOVED', 'INVESTIGATION_ADDED', 'INVESTIGATION_UPDATED', 'INVESTIGATION_REMOVED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('DRAFT', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "encounter_diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"label" text NOT NULL,
	"certainty" "diagnosis_certainty" DEFAULT 'PROVISIONAL' NOT NULL,
	"code" text,
	"code_system" text,
	"note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"event_type" "encounter_event_type" NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounter_investigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"appointment_id" uuid,
	"status" "encounter_status" DEFAULT 'DRAFT' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"chief_complaints" text,
	"present_illness" text,
	"past_history" text,
	"examination" text,
	"assessment" text,
	"advice" text,
	"vital_height_cm" numeric(5, 1),
	"vital_weight_kg" numeric(5, 1),
	"vital_temperature_c" numeric(4, 1),
	"vital_pulse_bpm" integer,
	"vital_systolic" integer,
	"vital_diastolic" integer,
	"vital_resp_rate" integer,
	"vital_spo2" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "encounter_diagnoses" ADD CONSTRAINT "encounter_diagnoses_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_events" ADD CONSTRAINT "encounter_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_investigations" ADD CONSTRAINT "encounter_investigations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "encounter_diagnoses_encounter_idx" ON "encounter_diagnoses" USING btree ("encounter_id","position");--> statement-breakpoint
CREATE INDEX "encounter_events_encounter_idx" ON "encounter_events" USING btree ("encounter_id","seq");--> statement-breakpoint
CREATE INDEX "encounter_investigations_encounter_idx" ON "encounter_investigations" USING btree ("encounter_id","position");--> statement-breakpoint
CREATE INDEX "encounters_doctor_idx" ON "encounters" USING btree ("owner_doctor_id","started_at");--> statement-breakpoint
CREATE INDEX "encounters_patient_idx" ON "encounters" USING btree ("patient_id","started_at");--> statement-breakpoint
CREATE INDEX "encounters_location_idx" ON "encounters" USING btree ("practice_location_id");--> statement-breakpoint
CREATE INDEX "encounters_appointment_idx" ON "encounters" USING btree ("appointment_id");