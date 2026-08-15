CREATE TABLE "patient_private_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"body" text NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_private_notes" ADD CONSTRAINT "patient_private_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_private_notes" ADD CONSTRAINT "patient_private_notes_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_private_notes_patient_key" ON "patient_private_notes" USING btree ("patient_id");--> statement-breakpoint
-- MOVE the existing notes before dropping the column. Drizzle generated only
-- the DROP; running that alone would destroy every clinical note written so far.
INSERT INTO "patient_private_notes" ("patient_id", "body")
SELECT "id", "notes" FROM "patients"
WHERE "notes" IS NOT NULL AND btrim("notes") <> ''
ON CONFLICT ("patient_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "patients" DROP COLUMN "notes";