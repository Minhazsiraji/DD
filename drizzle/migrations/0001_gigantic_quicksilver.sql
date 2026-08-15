CREATE TYPE "public"."alert_severity" AS ENUM('INFO', 'CAUTION', 'SERIOUS', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."allergy_severity" AS ENUM('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING');--> statement-breakpoint
CREATE TYPE "public"."blood_group" AS ENUM('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."condition_status" AS ENUM('ACTIVE', 'RESOLVED', 'SUSPECTED');--> statement-breakpoint
CREATE TYPE "public"."contact_type" AS ENUM('EMERGENCY', 'GUARDIAN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."dob_precision" AS ENUM('DAY', 'MONTH', 'YEAR', 'AGE_ONLY');--> statement-breakpoint
CREATE TYPE "public"."medication_source" AS ENUM('REPORTED', 'PRESCRIBED');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('MALE', 'FEMALE', 'OTHER', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "patient_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"severity" "alert_severity" DEFAULT 'CAUTION' NOT NULL,
	"message" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_allergies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"substance" text NOT NULL,
	"reaction" text,
	"severity" "allergy_severity" DEFAULT 'MODERATE' NOT NULL,
	"onset_date" date,
	"notes" text,
	"recorded_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"condition" text NOT NULL,
	"icd10_code" text,
	"status" "condition_status" DEFAULT 'ACTIVE' NOT NULL,
	"onset_date" date,
	"resolved_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"type" "contact_type" DEFAULT 'EMERGENCY' NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"relationship" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"frequency" text,
	"source" "medication_source" DEFAULT 'REPORTED' NOT NULL,
	"started_on" date,
	"stopped_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"patient_account_id" uuid,
	"patient_number" text NOT NULL,
	"full_name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"dob" date,
	"dob_precision" "dob_precision" DEFAULT 'DAY' NOT NULL,
	"approx_age_years" integer,
	"age_recorded_on" date,
	"sex" "sex" DEFAULT 'UNKNOWN' NOT NULL,
	"phone" text,
	"phone_normalized" text,
	"email" text,
	"address" text,
	"district" text,
	"blood_group" "blood_group" DEFAULT 'UNKNOWN' NOT NULL,
	"height_cm" numeric,
	"weight_kg" numeric,
	"notes" text,
	"is_deceased" boolean DEFAULT false NOT NULL,
	"merged_into_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "patient_alerts" ADD CONSTRAINT "patient_alerts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_alerts" ADD CONSTRAINT "patient_alerts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_recorded_by_profiles_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_medications" ADD CONSTRAINT "patient_medications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_alerts_patient_idx" ON "patient_alerts" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_allergies_patient_idx" ON "patient_allergies" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_conditions_patient_idx" ON "patient_conditions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_contacts_patient_idx" ON "patient_contacts" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_medications_patient_idx" ON "patient_medications" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_owner_number_key" ON "patients" USING btree ("owner_doctor_id","patient_number");--> statement-breakpoint
CREATE INDEX "patients_owner_idx" ON "patients" USING btree ("owner_doctor_id");--> statement-breakpoint
CREATE INDEX "patients_owner_phone_idx" ON "patients" USING btree ("owner_doctor_id","phone_normalized");--> statement-breakpoint
CREATE INDEX "patients_owner_name_idx" ON "patients" USING btree ("owner_doctor_id","name_normalized");--> statement-breakpoint
CREATE INDEX "patients_account_idx" ON "patients" USING btree ("patient_account_id");