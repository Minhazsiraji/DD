CREATE TYPE "public"."document_type" AS ENUM('LAB_REPORT', 'IMAGING_REPORT', 'PREVIOUS_PRESCRIPTION', 'DISCHARGE_SUMMARY', 'REFERRAL', 'MEDICAL_CERTIFICATE', 'OTHER');--> statement-breakpoint
CREATE TABLE "patient_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"encounter_id" uuid,
	"document_type" "document_type" DEFAULT 'OTHER' NOT NULL,
	"title" text NOT NULL,
	"document_date" date,
	"notes" text,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_filename" text NOT NULL,
	"uploaded_by" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_documents_title" CHECK (length(btrim(title)) between 1 and 200),
	CONSTRAINT "patient_documents_notes" CHECK (notes is null or length(notes) <= 2000),
	CONSTRAINT "patient_documents_size" CHECK (size_bytes > 0 and size_bytes <= 10485760),
	CONSTRAINT "patient_documents_mime" CHECK (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "patient_documents_archive_consistent" CHECK ((archived_at is null and archived_by is null and archive_reason is null)
          or (archived_at is not null))
);
--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_archived_by_profiles_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_id_owner_key" ON "patients" USING btree ("id","owner_doctor_id");--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patient_owner_fk" FOREIGN KEY ("patient_id","owner_doctor_id") REFERENCES "public"."patients"("id","owner_doctor_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_documents_owner_idx" ON "patient_documents" USING btree ("owner_doctor_id","created_at");--> statement-breakpoint
CREATE INDEX "patient_documents_patient_idx" ON "patient_documents" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "patient_documents_encounter_idx" ON "patient_documents" USING btree ("encounter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_documents_storage_path_key" ON "patient_documents" USING btree ("storage_path");

--> statement-breakpoint
ALTER TYPE "public"."location_role" ADD VALUE IF NOT EXISTS 'ASSISTANT';
--> statement-breakpoint
ALTER TABLE "patient_documents" ADD COLUMN "sha256" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_sha256" CHECK ("patient_documents"."sha256" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
CREATE INDEX "patient_documents_owner_archive_created_idx" ON "patient_documents" USING btree ("owner_doctor_id","archived_at","created_at");
--> statement-breakpoint
CREATE INDEX "patient_documents_patient_archive_created_idx" ON "patient_documents" USING btree ("patient_id","archived_at","created_at");
--> statement-breakpoint
CREATE TABLE "patient_document_events" (
  "seq" bigserial PRIMARY KEY NOT NULL,
  "document_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "actor_id" uuid,
  "reason" text,
  "at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT "patient_document_events_type" CHECK (event_type in ('ARCHIVED','RESTORED')),
  CONSTRAINT "patient_document_events_reason" CHECK ((event_type='ARCHIVED' and reason is not null and length(btrim(reason)) between 5 and 500) or (event_type='RESTORED' and reason is null))
);
--> statement-breakpoint
ALTER TABLE "patient_document_events" ADD CONSTRAINT "patient_document_events_document_id_patient_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."patient_documents"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "patient_document_events" ADD CONSTRAINT "patient_document_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "patient_document_events_document_idx" ON "patient_document_events" USING btree ("document_id","seq");
