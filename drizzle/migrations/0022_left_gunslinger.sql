CREATE TABLE "practice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"gross_amount" numeric(12, 2) NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refunded_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"method" text DEFAULT 'CASH' NOT NULL,
	"status" text DEFAULT 'PAID' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_payments_amounts" CHECK (gross_amount >= 0 and paid_amount >= 0 and refunded_amount >= 0 and refunded_amount <= paid_amount),
	CONSTRAINT "practice_payments_method" CHECK (method in ('CASH','BKASH','NAGAD','BANGLAQR','CARD','BANK','OTHER')),
	CONSTRAINT "practice_payments_status" CHECK (status in ('UNPAID','PARTIAL','PAID','REFUNDED','WAIVED')),
	CONSTRAINT "practice_payments_note" CHECK (note is null or length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE "practice_payments" ADD CONSTRAINT "practice_payments_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_payments" ADD CONSTRAINT "practice_payments_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_payments_doctor_date_idx" ON "practice_payments" USING btree ("owner_doctor_id","payment_date");--> statement-breakpoint
CREATE INDEX "practice_payments_location_date_idx" ON "practice_payments" USING btree ("practice_location_id","payment_date");