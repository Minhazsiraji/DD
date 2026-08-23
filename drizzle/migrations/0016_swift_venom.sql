CREATE TYPE "public"."profile_visibility" AS ENUM('PRIVATE', 'PUBLIC');--> statement-breakpoint
CREATE TABLE "doctor_chamber_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chamber_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_chamber_hours_weekday" CHECK (weekday between 0 and 6),
	CONSTRAINT "doctor_chamber_hours_order" CHECK (starts_at::time < ends_at::time),
	CONSTRAINT "doctor_chamber_hours_shape" CHECK (starts_at ~ '^\d{2}:\d{2}$' and ends_at ~ '^\d{2}:\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "doctor_chambers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"public_note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_chambers_note_length" CHECK (public_note is null or length(public_note) <= 120)
);
--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "professional_photo_path" text;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "show_bmdc_on_profile" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "profile_visibility" "profile_visibility" DEFAULT 'PRIVATE' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD COLUMN "profile_slug" text;--> statement-breakpoint
ALTER TABLE "doctor_chamber_hours" ADD CONSTRAINT "doctor_chamber_hours_chamber_id_doctor_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."doctor_chambers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_chambers" ADD CONSTRAINT "doctor_chambers_doctor_profile_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_profile_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_chambers" ADD CONSTRAINT "doctor_chambers_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_chamber_hours_chamber_idx" ON "doctor_chamber_hours" USING btree ("chamber_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_chambers_doctor_location_key" ON "doctor_chambers" USING btree ("doctor_profile_id","practice_location_id");--> statement-breakpoint
CREATE INDEX "doctor_chambers_doctor_idx" ON "doctor_chambers" USING btree ("doctor_profile_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_profiles_slug_unique" ON "doctor_profiles" USING btree ("profile_slug") WHERE profile_slug is not null;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_slug_shape" CHECK (profile_slug is null or profile_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$');