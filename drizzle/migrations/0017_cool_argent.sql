CREATE TYPE "public"."rx_module" AS ENUM('CHIEF_COMPLAINT', 'SYMPTOMS', 'HISTORY', 'VITALS', 'EXAMINATION', 'ASSESSMENT', 'DIAGNOSIS', 'INVESTIGATIONS', 'ADVICE', 'NEXT_VISIT', 'ALLERGY', 'LONG_TERM_MEDICINES');--> statement-breakpoint
CREATE TYPE "public"."rx_phrase_kind" AS ENUM('CHIEF_COMPLAINT', 'SYMPTOMS', 'HISTORY', 'EXAMINATION', 'DIAGNOSIS', 'INVESTIGATION', 'ADVICE');--> statement-breakpoint
CREATE TABLE "doctor_phrases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"kind" "rx_phrase_kind" NOT NULL,
	"text" text NOT NULL,
	"text_normalized" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(text, '\s+', ' ', 'g')))) STORED,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_phrases_text_length" CHECK (btrim(text) <> '' and length(text) <= 200)
);
--> statement-breakpoint
CREATE TABLE "doctor_prescription_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"module" "rx_module" NOT NULL,
	"use_during_consultation" boolean DEFAULT true NOT NULL,
	"show_on_print" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"print_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_rx_modules_label_length" CHECK (print_label is null or (btrim(print_label) <> '' and length(print_label) <= 40))
);
--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "symptoms" text;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "next_visit_note" text;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "next_visit_on" date;--> statement-breakpoint
ALTER TABLE "doctor_phrases" ADD CONSTRAINT "doctor_phrases_doctor_profile_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_profile_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_prescription_modules" ADD CONSTRAINT "doctor_prescription_modules_doctor_profile_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_profile_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_phrases_unique" ON "doctor_phrases" USING btree ("doctor_profile_id","kind","text_normalized");--> statement-breakpoint
CREATE INDEX "doctor_phrases_lookup_idx" ON "doctor_phrases" USING btree ("doctor_profile_id","kind","usage_count");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_rx_modules_doctor_module_key" ON "doctor_prescription_modules" USING btree ("doctor_profile_id","module");--> statement-breakpoint
CREATE INDEX "doctor_rx_modules_doctor_idx" ON "doctor_prescription_modules" USING btree ("doctor_profile_id","position");