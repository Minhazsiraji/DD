CREATE TYPE "public"."medicine_source_kind" AS ENUM('MANUAL_SEED', 'DOCTOR_CONTRIBUTED', 'LICENSED_IMPORT');--> statement-breakpoint
CREATE TABLE "doctor_medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"medicine_reference_id" uuid,
	"display_name" text NOT NULL,
	"generic_name" text,
	"brand_name" text,
	"strength_text" text,
	"dosage_form" text,
	"route" text,
	"default_dose_text" text,
	"default_schedule_text" text,
	"default_duration_text" text,
	"default_quantity_text" text,
	"default_food_relation" text,
	"default_instructions" text,
	"default_is_prn" boolean DEFAULT false NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_normalized" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(display_name, '\s+', ' ', 'g')))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_medicines_display_not_blank" CHECK (btrim(display_name) <> ''),
	CONSTRAINT "doctor_medicines_lengths" CHECK (length(display_name) <= 200
        and (generic_name is null or length(generic_name) <= 200)
        and (brand_name is null or length(brand_name) <= 200)
        and (strength_text is null or length(strength_text) <= 100)
        and (dosage_form is null or length(dosage_form) <= 100)
        and (route is null or length(route) <= 100)
        and (default_dose_text is null or length(default_dose_text) <= 100)
        and (default_schedule_text is null or length(default_schedule_text) <= 100)
        and (default_duration_text is null or length(default_duration_text) <= 100)
        and (default_quantity_text is null or length(default_quantity_text) <= 100)
        and (default_food_relation is null or length(default_food_relation) <= 100)
        and (default_instructions is null or length(default_instructions) <= 1000)),
	CONSTRAINT "doctor_medicines_usage_count" CHECK (usage_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "medicine_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generic_name" text NOT NULL,
	"brand_name" text,
	"strength_text" text,
	"dosage_form" text,
	"manufacturer" text,
	"country_code" text NOT NULL,
	"regulator_name" text,
	"source_kind" "medicine_source_kind" DEFAULT 'MANUAL_SEED' NOT NULL,
	"source_note" text,
	"last_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"generic_normalized" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(generic_name, '\s+', ' ', 'g')))) STORED,
	"brand_normalized" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(coalesce(brand_name, ''), '\s+', ' ', 'g')))) STORED,
	"search_text" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(
        generic_name || ' ' || coalesce(brand_name, '') || ' ' ||
        coalesce(strength_text, '') || ' ' || coalesce(dosage_form, ''),
        '\s+', ' ', 'g')))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medicine_references_generic_not_blank" CHECK (btrim(generic_name) <> ''),
	CONSTRAINT "medicine_references_country_code" CHECK (country_code ~ '^[A-Z]{2}$'),
	CONSTRAINT "medicine_references_lengths" CHECK (length(generic_name) <= 200
        and (brand_name is null or length(brand_name) <= 200)
        and (strength_text is null or length(strength_text) <= 100)
        and (dosage_form is null or length(dosage_form) <= 100)
        and (manufacturer is null or length(manufacturer) <= 200)
        and (regulator_name is null or length(regulator_name) <= 100)
        and (source_note is null or length(source_note) <= 500))
);
--> statement-breakpoint
ALTER TABLE "doctor_medicines" ADD CONSTRAINT "doctor_medicines_doctor_profile_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_profile_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_medicines" ADD CONSTRAINT "doctor_medicines_medicine_reference_id_medicine_references_id_fk" FOREIGN KEY ("medicine_reference_id") REFERENCES "public"."medicine_references"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_medicines_unique" ON "doctor_medicines" USING btree ("doctor_profile_id","display_normalized","strength_text");--> statement-breakpoint
CREATE INDEX "doctor_medicines_library_idx" ON "doctor_medicines" USING btree ("doctor_profile_id","is_active","is_favorite");--> statement-breakpoint
CREATE INDEX "doctor_medicines_recent_idx" ON "doctor_medicines" USING btree ("doctor_profile_id","last_used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "medicine_references_identity" ON "medicine_references" USING btree ("country_code","generic_normalized","brand_normalized","strength_text","dosage_form");--> statement-breakpoint
CREATE INDEX "medicine_references_generic_idx" ON "medicine_references" USING btree ("generic_normalized");--> statement-breakpoint
CREATE INDEX "medicine_references_brand_idx" ON "medicine_references" USING btree ("brand_normalized");--> statement-breakpoint
CREATE INDEX "medicine_references_country_idx" ON "medicine_references" USING btree ("country_code","is_active");