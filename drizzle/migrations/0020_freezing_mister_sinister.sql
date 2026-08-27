CREATE TYPE "public"."doctor_profile_claim_status" AS ENUM('PENDING', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "doctor_profile_claim_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"from_status" "doctor_profile_claim_status",
	"to_status" "doctor_profile_claim_status" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "doctor_profile_claim_events_note" CHECK (note is null or length(note) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "doctor_profile_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"claimant_user_id" uuid NOT NULL,
	"status" "doctor_profile_claim_status" DEFAULT 'PENDING' NOT NULL,
	"country_code" text NOT NULL,
	"regulator_name" text NOT NULL,
	"registration_number" text NOT NULL,
	"claimed_full_name" text NOT NULL,
	"evidence_note" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_profile_claims_country" CHECK (country_code ~ '^[A-Z]{2}$'),
	CONSTRAINT "doctor_profile_claims_registration" CHECK (length(btrim(registration_number)) between 2 and 64),
	CONSTRAINT "doctor_profile_claims_regulator" CHECK (length(btrim(regulator_name)) between 2 and 120),
	CONSTRAINT "doctor_profile_claims_name" CHECK (length(btrim(claimed_full_name)) between 2 and 120),
	CONSTRAINT "doctor_profile_claims_evidence" CHECK (evidence_note is null or length(evidence_note) <= 1000),
	CONSTRAINT "doctor_profile_claims_note" CHECK (decision_note is null or length(decision_note) <= 1000),
	CONSTRAINT "doctor_profile_claims_decision" CHECK ((status in ('PENDING','NEEDS_INFORMATION') and decided_at is null)
          or (status in ('APPROVED','REJECTED','CANCELLED') and decided_at is not null))
);
--> statement-breakpoint
ALTER TABLE "doctor_profile_claim_events" ADD CONSTRAINT "doctor_profile_claim_events_claim_id_doctor_profile_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."doctor_profile_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profile_claim_events" ADD CONSTRAINT "doctor_profile_claim_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profile_claims" ADD CONSTRAINT "doctor_profile_claims_doctor_profile_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_profile_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profile_claims" ADD CONSTRAINT "doctor_profile_claims_claimant_user_id_profiles_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profile_claims" ADD CONSTRAINT "doctor_profile_claims_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_profile_claim_events_claim_idx" ON "doctor_profile_claim_events" USING btree ("claim_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_profile_claims_open_key" ON "doctor_profile_claims" USING btree ("doctor_profile_id","claimant_user_id") WHERE status in ('PENDING', 'NEEDS_INFORMATION');--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_profile_claims_approved_key" ON "doctor_profile_claims" USING btree ("doctor_profile_id") WHERE status = 'APPROVED';--> statement-breakpoint
CREATE INDEX "doctor_profile_claims_status_idx" ON "doctor_profile_claims" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "doctor_profile_claims_claimant_idx" ON "doctor_profile_claims" USING btree ("claimant_user_id");