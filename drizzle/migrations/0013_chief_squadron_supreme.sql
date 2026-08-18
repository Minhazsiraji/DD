ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_finalized_is_complete";--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "review_bundle_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_finalized_is_complete" CHECK (status <> 'FINALIZED' or (
        finalized_at is not null
        and snapshot_schema_version is not null
        and review_bundle_snapshot is not null
        and review_bundle_snapshot ? 'clinicalDate'
        and doctor_snapshot is not null
        and location_snapshot is not null
        and patient_snapshot is not null
        and template_snapshot is not null
        and items_snapshot is not null
        and review_digest is not null
      ));