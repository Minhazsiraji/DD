CREATE TABLE "doctor_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"expense_name" text NOT NULL,
	"expense_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_expenses_name" CHECK (btrim(expense_name) <> '' and length(expense_name) <= 120),
	CONSTRAINT "doctor_expenses_amount" CHECK (amount > 0),
	CONSTRAINT "doctor_expenses_reason" CHECK (reason is null or length(reason) <= 500)
);
--> statement-breakpoint
ALTER TABLE "doctor_expenses" ADD CONSTRAINT "doctor_expenses_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_expenses" ADD CONSTRAINT "doctor_expenses_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_expenses_doctor_date_idx" ON "doctor_expenses" USING btree ("owner_doctor_id","expense_date");--> statement-breakpoint
CREATE INDEX "doctor_expenses_location_date_idx" ON "doctor_expenses" USING btree ("practice_location_id","expense_date");