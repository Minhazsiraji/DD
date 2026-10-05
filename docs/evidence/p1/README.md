# Doctor's Diary Database V2 — P1 Identity Completion

Status: IMPLEMENTATION STARTED on isolated branch `v2/p1-identity-completion` after P0 merge to `main`.

Governing architecture: Rev 4.3.2f + accepted C2 addenda.

## P1 scope

- Complete `professional_credentials` human workflow: submit -> review -> decide.
- Add P1-only credential fields after `platform_staff` exists: `verification_method`, `verified_by_staff_id`, `evidence_ref`.
- Add `credential_review_events` and four-eyes/self-decision protection.
- Add `medical_institutions`, `medical_student_profiles`, `student_enrollments` and the `MEDICAL_STUDENT` capability source.
- Add `platform_staff` and the canonical nine `platform_staff_roles`.
- Extend the existing P0 `profile_capabilities` projection to student enrollments using the same mechanism.
- Add P1 owner analytics surface under explicit `PLATFORM_ANALYST` authority.

## P1 exit proofs

- `verify-doctor-claim`
- `verify-capability-projection` extended to credential + student-enrollment multi-source set equality/staleness
- `verify-student-no-clinical`
- `verify-role-enum-separation`
- `verify-owner-authority` per platform role
- all P0 proofs remain cumulatively green
- lint, typecheck, full tests, build, deterministic deployment evidence

## Safety

P1 work remains isolated. No Track B contact, protected/shared reset, cutover, production deployment, Voice or DGDA is authorized by this lane.
