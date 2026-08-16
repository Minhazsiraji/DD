-- Hand-added. drizzle-kit cannot emit these: the one-draft indexes were created
-- by the policy replay in 0016, so they never entered a snapshot and the
-- generator does not know the old shape exists. Without the drops this
-- migration fails on every database that has already replayed the policies, and
-- the location-blind index survives on any database that has not.
--
-- Forward-only: 0009 is untouched.
DROP INDEX IF EXISTS "encounters_one_unscheduled_draft";--> statement-breakpoint
DROP INDEX IF EXISTS "encounters_one_unscheduled_draft_at_location";--> statement-breakpoint
DROP INDEX IF EXISTS "encounters_one_draft_per_appointment";--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_one_draft_per_appointment" ON "encounters" USING btree ("appointment_id") WHERE status = 'DRAFT' and appointment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_one_unscheduled_draft_at_location" ON "encounters" USING btree ("owner_doctor_id","patient_id","practice_location_id") WHERE status = 'DRAFT' and appointment_id is null;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_height_range" CHECK (vital_height_cm is null
      or (vital_height_cm > 0 and vital_height_cm <= 300));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_weight_range" CHECK (vital_weight_kg is null
      or (vital_weight_kg > 0 and vital_weight_kg <= 700));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_temperature_range" CHECK (vital_temperature_c is null
      or (vital_temperature_c >= 10 and vital_temperature_c <= 50));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_pulse_range" CHECK (vital_pulse_bpm is null
      or (vital_pulse_bpm > 0 and vital_pulse_bpm <= 400));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_systolic_range" CHECK (vital_systolic is null
      or (vital_systolic > 0 and vital_systolic <= 400));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_diastolic_range" CHECK (vital_diastolic is null
      or (vital_diastolic > 0 and vital_diastolic <= 300));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_resp_rate_range" CHECK (vital_resp_rate is null
      or (vital_resp_rate > 0 and vital_resp_rate <= 200));--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_spo2_range" CHECK (vital_spo2 is null
      or (vital_spo2 >= 0 and vital_spo2 <= 100));