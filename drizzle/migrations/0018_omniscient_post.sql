CREATE TABLE "doctor_booking_closed_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_chamber_id" uuid NOT NULL,
	"closed_on" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_booking_closed_dates_reason" CHECK (reason is null or length(reason) <= 120)
);
--> statement-breakpoint
CREATE TABLE "doctor_booking_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"doctor_chamber_id" uuid NOT NULL,
	"booking_enabled" boolean DEFAULT false NOT NULL,
	"booking_mode" text DEFAULT 'TOKEN' NOT NULL,
	"slot_minutes" integer DEFAULT 15 NOT NULL,
	"max_patients" integer DEFAULT 30 NOT NULL,
	"booking_window_days" integer DEFAULT 30 NOT NULL,
	"min_lead_minutes" integer DEFAULT 60 NOT NULL,
	"consultation_fee" numeric(12, 2),
	"currency" text DEFAULT 'BDT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_booking_settings_mode" CHECK (booking_mode in ('TOKEN', 'TIME_SLOT')),
	CONSTRAINT "doctor_booking_settings_slot" CHECK (slot_minutes between 5 and 180),
	CONSTRAINT "doctor_booking_settings_max" CHECK (max_patients between 1 and 500),
	CONSTRAINT "doctor_booking_settings_window" CHECK (booking_window_days between 1 and 180),
	CONSTRAINT "doctor_booking_settings_lead" CHECK (min_lead_minutes between 0 and 10080),
	CONSTRAINT "doctor_booking_settings_currency" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "doctor_booking_settings_fee" CHECK (consultation_fee is null or consultation_fee >= 0)
);
--> statement-breakpoint
CREATE TABLE "doctor_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'PILOT' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"founder_discount_percent" numeric(5, 2),
	"founder_price_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_subscriptions_status" CHECK (status in ('PILOT','TRIAL','ACTIVE','GRACE_PERIOD','PAST_DUE','CANCELLED','EXPIRED')),
	CONSTRAINT "doctor_subscriptions_discount" CHECK (founder_discount_percent is null or founder_discount_percent between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"method" text DEFAULT 'MANUAL_BANK' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payer_reference" text,
	"note" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payments_amount" CHECK (amount > 0),
	CONSTRAINT "subscription_payments_currency" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "subscription_payments_method" CHECK (method in ('MANUAL_BANK','SSLCOMMERZ','CARD','OTHER')),
	CONSTRAINT "subscription_payments_status" CHECK (status in ('PENDING','CONFIRMED','REJECTED','REFUNDED')),
	CONSTRAINT "subscription_payments_reference" CHECK (payer_reference is null or length(payer_reference) <= 120),
	CONSTRAINT "subscription_payments_note" CHECK (note is null or length(note) <= 500)
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"monthly_price_bdt" numeric(12, 2) DEFAULT '0' NOT NULL,
	"annual_price_bdt" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_founder_plan" boolean DEFAULT false NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_code_shape" CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
	CONSTRAINT "subscription_plans_monthly" CHECK (monthly_price_bdt >= 0),
	CONSTRAINT "subscription_plans_annual" CHECK (annual_price_bdt is null or annual_price_bdt >= 0)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "booking_source" text DEFAULT 'INTERNAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "public_booking_ref" uuid;--> statement-breakpoint
ALTER TABLE "doctor_booking_closed_dates" ADD CONSTRAINT "doctor_booking_closed_dates_doctor_chamber_id_doctor_chambers_id_fk" FOREIGN KEY ("doctor_chamber_id") REFERENCES "public"."doctor_chambers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_booking_settings" ADD CONSTRAINT "doctor_booking_settings_doctor_profile_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_profile_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_booking_settings" ADD CONSTRAINT "doctor_booking_settings_doctor_chamber_id_doctor_chambers_id_fk" FOREIGN KEY ("doctor_chamber_id") REFERENCES "public"."doctor_chambers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_subscriptions" ADD CONSTRAINT "doctor_subscriptions_doctor_profile_id_doctor_profiles_id_fk" FOREIGN KEY ("doctor_profile_id") REFERENCES "public"."doctor_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_subscriptions" ADD CONSTRAINT "doctor_subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_doctor_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."doctor_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_recorded_by_profiles_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_booking_closed_dates_key" ON "doctor_booking_closed_dates" USING btree ("doctor_chamber_id","closed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_booking_settings_chamber_key" ON "doctor_booking_settings" USING btree ("doctor_chamber_id");--> statement-breakpoint
CREATE INDEX "doctor_booking_settings_doctor_idx" ON "doctor_booking_settings" USING btree ("doctor_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_subscriptions_doctor_key" ON "doctor_subscriptions" USING btree ("doctor_profile_id");--> statement-breakpoint
CREATE INDEX "subscription_payments_subscription_idx" ON "subscription_payments" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_public_booking_ref_key" ON "appointments" USING btree ("public_booking_ref") WHERE public_booking_ref is not null;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booking_source_check" CHECK (booking_source in ('INTERNAL', 'DOCTOR', 'RECEPTIONIST', 'ASSISTANT', 'WALK_IN', 'PUBLIC'));