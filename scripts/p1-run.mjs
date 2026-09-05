import { pathToFileURL } from "node:url";
import { requireLocalP0DatabaseUrl } from "./p0-target.mjs";

const P1_SCRIPTS = new Set([
  "scripts/deploy-p1.mjs",
  "scripts/verify-doctor-claim.mjs",
  "scripts/verify-capability-projection.mjs",
  "scripts/verify-student-no-clinical.mjs",
  "scripts/verify-role-enum-separation.mjs",
  "scripts/verify-owner-authority.mjs",
  "scripts/verify-staff-role-inventory.mjs",
  "scripts/verify-owner-designation-not-authority.mjs",
  "scripts/verify-health-signal-detail-bound.mjs",
  "scripts/verify-p1-security-surface.mjs",
  "scripts/verify-p1-credential-workflow.mjs",
  "scripts/verify-credential-review-queue.mjs",
  "scripts/verify-platform-staff-lifecycle.mjs",
  "scripts/verify-platform-admin-bootstrap.mjs",
  "scripts/verify-security.mjs",
  "scripts/verify-patients.mjs",
  "scripts/verify-doctor-isolation.mjs",
  "scripts/verify-templates.mjs",
  "scripts/verify-appointments.mjs",
  "scripts/verify-queue.mjs",
  "scripts/verify-encounters.mjs",
  "scripts/verify-prescriptions.mjs",
  "scripts/verify-signature-freeze.mjs",
  "scripts/verify-handover.mjs",
  "scripts/verify-api-auth.mjs",
  "scripts/verify-correction.mjs",
  "scripts/verify-doctor-identity.mjs",
  "scripts/verify-encounter-close.mjs",
  "scripts/verify-history.mjs",
  "scripts/verify-rx-immutability.mjs",
  "scripts/verify-rx-v4.mjs",
  "scripts/verify-professional-profile.mjs",
  "scripts/verify-qa-provenance.mjs",
  "scripts/verify-qa-cleanup.mjs",
  "scripts/verify-migrations.mjs",
  "scripts/verify-credential-integrity.mjs",
  "scripts/verify-custodial-vs-practice-authority.mjs",
  "scripts/verify-anon-surface.mjs",
  "scripts/verify-no-hardcoded-jurisdiction.mjs",
  "scripts/verify-dd-number-immutable.mjs",
  "scripts/verify-dd-number-not-authority.mjs",
  "scripts/verify-control-plane-isolation.mjs",
  "scripts/verify-rollup-consistency.mjs",
  "scripts/verify-storage-paths.mjs",
  "scripts/verify-phone-canonicalization.mjs",
  "scripts/verify-no-exclusion-predicates.mjs",
  "scripts/verify-audit-no-clinical-payload.mjs",
  "scripts/verify-relationship-label-not-authority.mjs",
  "scripts/verify-live-edge-uniformity.mjs",
  "scripts/verify-public-booking-representability.mjs",
  "scripts/verify-anon-operational-controls.mjs",
  "scripts/verify-appointments-p0.mjs",
]);

const [script,...args]=process.argv.slice(2);
if (!script) throw new Error("usage: p1-run.mjs <p1-script> [args]");
const normalized=script.replace(/\\/g,"/");
if (!P1_SCRIPTS.has(normalized)) throw new Error(`p1-run.mjs refuses ${script}: not in the P1 cumulative allowlist`);
const databaseUrl=requireLocalP0DatabaseUrl();
process.env.DD_V2_LOCAL_DATABASE_URL=databaseUrl;
process.argv=[process.argv[0],script,...args,databaseUrl];
await import(pathToFileURL(`${process.cwd()}/${script}`).href);
