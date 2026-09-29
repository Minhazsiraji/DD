CREATE TABLE "doctor_payment_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"cash_enabled" boolean DEFAULT true NOT NULL,
	"online_payment_enabled" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'SSLCOMMERZ' NOT NULL,
	"environment" text DEFAULT 'SANDBOX' NOT NULL,
	"store_identifier" text,
	"bangla_qr_status" text DEFAULT 'MERCHANT_ACTIVATION_REQUIRED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_payment_settings_owner_doctor_id_unique" UNIQUE("owner_doctor_id"),
	CONSTRAINT "doctor_payment_settings_provider" CHECK (provider = 'SSLCOMMERZ'),
	CONSTRAINT "doctor_payment_settings_environment" CHECK (environment = 'SANDBOX')
);
--> statement-breakpoint
CREATE TABLE "practice_payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_doctor_id" uuid NOT NULL,
	"practice_location_id" uuid NOT NULL,
	"practice_payment_id" uuid,
	"appointment_id" uuid,
	"encounter_id" uuid,
	"provider" text DEFAULT 'SSLCOMMERZ' NOT NULL,
	"merchant_transaction_id" text NOT NULL,
	"provider_transaction_id" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"payment_channel" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"refund_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"verified_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_payment_transactions_merchant_transaction_id_unique" UNIQUE("merchant_transaction_id"),
	CONSTRAINT "practice_payment_tx_status" CHECK (status in ('PENDING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
	CONSTRAINT "practice_payment_tx_amount" CHECK (amount > 0 and refund_amount >= 0 and refund_amount <= amount)
);
--> statement-breakpoint
ALTER TABLE "practice_payments" DROP CONSTRAINT "practice_payments_method";--> statement-breakpoint
ALTER TABLE "doctor_payment_settings" ADD CONSTRAINT "doctor_payment_settings_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_payment_transactions" ADD CONSTRAINT "practice_payment_transactions_owner_doctor_id_doctor_profiles_id_fk" FOREIGN KEY ("owner_doctor_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_payment_transactions" ADD CONSTRAINT "practice_payment_transactions_practice_location_id_practice_locations_id_fk" FOREIGN KEY ("practice_location_id") REFERENCES "public"."practice_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_payment_transactions" ADD CONSTRAINT "practice_payment_transactions_practice_payment_id_practice_payments_id_fk" FOREIGN KEY ("practice_payment_id") REFERENCES "public"."practice_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_payment_tx_doctor_idx" ON "practice_payment_transactions" USING btree ("owner_doctor_id","created_at");--> statement-breakpoint
CREATE INDEX "practice_payment_tx_location_idx" ON "practice_payment_transactions" USING btree ("practice_location_id","created_at");--> statement-breakpoint
ALTER TABLE "practice_payments" ADD CONSTRAINT "practice_payments_method" CHECK (method in ('CASH','BKASH','NAGAD','BANGLAQR','CARD','BANK','OTHER'));