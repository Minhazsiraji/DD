CREATE TYPE "public"."location_role" AS ENUM('DOCTOR', 'RECEPTIONIST', 'LOCATION_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('PERSONAL_CHAMBER', 'CLINIC', 'HOSPITAL', 'TELEMEDICINE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_location_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"ip" text,
	"user_agent" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"qualification" text,
	"specialization" text,
	"bmdc_registration_no" text,
	"signature_url" text,
	"patient_number_prefix" text DEFAULT 'PT' NOT NULL,
	"patient_number_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_location_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "location_role" NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "location_type" DEFAULT 'PERSONAL_CHAMBER' NOT NULL,
	"address" text,
	"district" text,
	"phone" text,
	"logo_url" text,
	"timezone" text DEFAULT 'Asia/Dhaka' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"avatar_url" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_location_members" ADD CONSTRAINT "practice_location_members_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_location_members" ADD CONSTRAINT "practice_location_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_location_members" ADD CONSTRAINT "practice_location_members_invited_by_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_locations" ADD CONSTRAINT "practice_locations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_location_occurred_idx" ON "audit_events" USING btree ("practice_location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_profiles_user_id_key" ON "doctor_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_location_members_location_user_role_key" ON "practice_location_members" USING btree ("practice_location_id","user_id","role");--> statement-breakpoint
CREATE INDEX "practice_location_members_user_idx" ON "practice_location_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "practice_location_members_location_idx" ON "practice_location_members" USING btree ("practice_location_id");--> statement-breakpoint
CREATE INDEX "practice_locations_created_by_idx" ON "practice_locations" USING btree ("created_by");

