CREATE TYPE "public"."paper_size" AS ENUM('A4', 'A5');--> statement-breakpoint
CREATE TABLE "prescription_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"practice_location_id" uuid,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"paper_size" "paper_size" DEFAULT 'A4' NOT NULL,
	"margin_mm" integer DEFAULT 15 NOT NULL,
	"base_font_pt" integer DEFAULT 11 NOT NULL,
	"show_header" boolean DEFAULT true NOT NULL,
	"show_clinic_logo" boolean DEFAULT false NOT NULL,
	"clinic_name_override" text,
	"header_note" text,
	"show_qualification" boolean DEFAULT true NOT NULL,
	"show_specialization" boolean DEFAULT true NOT NULL,
	"show_designation" boolean DEFAULT true NOT NULL,
	"show_bmdc" boolean DEFAULT true NOT NULL,
	"show_chamber_address" boolean DEFAULT true NOT NULL,
	"show_chamber_phone" boolean DEFAULT true NOT NULL,
	"show_footer" boolean DEFAULT true NOT NULL,
	"footer_text" text,
	"show_signature" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "designation" text;--> statement-breakpoint
ALTER TABLE "prescription_templates" ADD CONSTRAINT "prescription_templates_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_templates" ADD CONSTRAINT "prescription_templates_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prescription_templates_owner_idx" ON "prescription_templates" USING btree ("owner_doctor_id");--> statement-breakpoint
CREATE INDEX "prescription_templates_location_idx" ON "prescription_templates" USING btree ("practice_location_id");