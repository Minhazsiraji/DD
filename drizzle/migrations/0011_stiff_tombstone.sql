CREATE TYPE "public"."prescription_event_type" AS ENUM('CREATED', 'ITEM_ADDED', 'ITEM_UPDATED', 'ITEM_REMOVED', 'ITEM_MOVED', 'FINALIZED', 'REPLACEMENT_STARTED');--> statement-breakpoint
CREATE TYPE "public"."prescription_status" AS ENUM('DRAFT', 'FINALIZED', 'VOIDED');--> statement-breakpoint
CREATE TABLE "prescription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"event_type" "prescription_event_type" NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"seq" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"brand_name" text,
	"generic_name" text,
	"strength_text" text,
	"dose_text" text,
	"dosage_form" text,
	"route" text,
	"schedule_text" text,
	"duration_text" text,
	"quantity_text" text,
	"food_relation" text,
	"is_prn" boolean DEFAULT false NOT NULL,
	"instructions" text,
	"substitution_allowed" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescription_items_name_not_blank" CHECK (btrim(display_name) <> '')
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"status" "prescription_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"replaces_prescription_id" uuid,
	"replacement_reason" text,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"snapshot_schema_version" integer,
	"doctor_snapshot" jsonb,
	"location_snapshot" jsonb,
	"patient_snapshot" jsonb,
	"template_snapshot" jsonb,
	"template_id" uuid,
	"signature_asset_path" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_finalized_is_complete" CHECK (status <> 'FINALIZED' or (
        finalized_at is not null
        and snapshot_schema_version is not null
        and doctor_snapshot is not null
        and location_snapshot is not null
        and patient_snapshot is not null
        and template_snapshot is not null
      )),
	CONSTRAINT "prescriptions_replacement_has_reason" CHECK (replaces_prescription_id is null or replacement_reason is not null)
);
--> statement-breakpoint
ALTER TABLE "prescription_events" ADD CONSTRAINT "prescription_events_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_events" ADD CONSTRAINT "prescription_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_replaces_prescription_id_prescriptions_id_fk" FOREIGN KEY ("replaces_prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_finalized_by_profiles_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_template_id_prescription_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prescription_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prescription_events_prescription_idx" ON "prescription_events" USING btree ("prescription_id","seq");--> statement-breakpoint
CREATE INDEX "prescription_items_prescription_idx" ON "prescription_items" USING btree ("prescription_id","position");--> statement-breakpoint
CREATE INDEX "prescriptions_encounter_idx" ON "prescriptions" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "prescriptions_doctor_idx" ON "prescriptions" USING btree ("owner_doctor_id","created_at");--> statement-breakpoint
CREATE INDEX "prescriptions_patient_idx" ON "prescriptions" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "prescriptions_location_idx" ON "prescriptions" USING btree ("practice_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_one_draft_per_encounter" ON "prescriptions" USING btree ("encounter_id") WHERE status = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_one_replacement" ON "prescriptions" USING btree ("replaces_prescription_id") WHERE replaces_prescription_id is not null;