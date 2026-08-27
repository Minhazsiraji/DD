CREATE TABLE "platform_owners" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"granted_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "platform_owners_note" CHECK (note is null or length(note) <= 200),
	CONSTRAINT "platform_owners_revocation" CHECK ((is_active = true and revoked_at is null) or (is_active = false and revoked_at is not null))
);
--> statement-breakpoint
ALTER TABLE "platform_owners" ADD CONSTRAINT "platform_owners_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_owners" ADD CONSTRAINT "platform_owners_granted_by_profiles_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_owners_active_idx" ON "platform_owners" USING btree ("is_active");