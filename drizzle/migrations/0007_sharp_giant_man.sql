ALTER TABLE "appointment_events" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "appointment_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "appointment_events_seq_idx" ON "appointment_events" USING btree ("appointment_id","seq");