-- P0 reference seed. Jurisdiction-specific values belong here, never in schema DDL.
insert into metric_definitions(metric_code, display_name, unit, allowed_dimensions)
values
  ('DOCTORS_REGISTERED', 'Doctors registered', 'COUNT', array['doctor_id','period_start']::metric_dimension[]),
  ('DOCTORS_VERIFIED', 'Doctors verified', 'COUNT', array['doctor_id','period_start']::metric_dimension[]),
  ('APPOINTMENTS_BOOKED', 'Appointments booked', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[]),
  ('APPOINTMENTS_RESCHEDULED', 'Appointments rescheduled', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[]),
  ('APPOINTMENTS_CANCELLED', 'Appointments cancelled', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[]),
  ('APPOINTMENTS_NO_SHOW', 'Appointments no-show', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[]),
  ('APPOINTMENTS_COMPLETED', 'Appointments completed', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[]),
  ('CONSULTATIONS_COMPLETED', 'Consultations completed', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[]),
  ('CONSULTATIONS_ABANDONED', 'Consultations abandoned', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[]),
  ('PRESCRIPTIONS_FINALIZED', 'Prescriptions finalized', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[]),
  ('PRESCRIPTIONS_CORRECTED', 'Prescriptions corrected', 'COUNT', array['doctor_id','practice_location_id','period_start']::metric_dimension[])
on conflict (metric_code) do update set
  display_name = excluded.display_name,
  unit = excluded.unit,
  allowed_dimensions = excluded.allowed_dimensions,
  is_active = true;

insert into metric_classification_registry(classification_code)
values ('STANDARD'), ('CORRECTION')
on conflict do nothing;


-- P0 anonymous operational-control configuration.
--
-- One-minute windows make the relative policy easy to inspect:
--   availability = least restrictive;
--   status       = stricter;
--   booking      = most restrictive.
--
-- Network budgets are intentionally four times session budgets to tolerate
-- legitimate shared-NAT traffic without weakening per-session enforcement.
-- Resource budgets are half of the corresponding global budget.
--
-- Version and timestamps are fixed configuration, not runtime-generated,
-- preserving deterministic replay/golden output.

insert into anon_rate_limit_policies(
  rpc_code,
  bucket_kind,
  window_seconds,
  max_requests,
  enabled,
  policy_version,
  effective_from,
  updated_at
)
values
  ('PUBLIC_CHAMBER_AVAILABILITY','SESSION_GLOBAL',    60,  60, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('PUBLIC_CHAMBER_AVAILABILITY','NETWORK_GLOBAL',    60, 240, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('PUBLIC_CHAMBER_AVAILABILITY','SESSION_RESOURCE',  60,  30, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('PUBLIC_CHAMBER_AVAILABILITY','NETWORK_RESOURCE',  60, 120, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),

  ('PUBLIC_BOOKING_STATUS','SESSION_GLOBAL',          60,  30, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('PUBLIC_BOOKING_STATUS','NETWORK_GLOBAL',          60, 120, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('PUBLIC_BOOKING_STATUS','SESSION_RESOURCE',        60,  15, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('PUBLIC_BOOKING_STATUS','NETWORK_RESOURCE',        60,  60, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),

  ('CREATE_PUBLIC_BOOKING','SESSION_GLOBAL',          60,   6, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('CREATE_PUBLIC_BOOKING','NETWORK_GLOBAL',          60,  24, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('CREATE_PUBLIC_BOOKING','SESSION_RESOURCE',        60,   3, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00'),
  ('CREATE_PUBLIC_BOOKING','NETWORK_RESOURCE',        60,  12, true, 'P0-2026-09-04-V1', '2026-09-04 00:00:00+00', '2026-09-04 00:00:00+00')
on conflict (rpc_code, bucket_kind, policy_version)
do update set
  window_seconds = excluded.window_seconds,
  max_requests = excluded.max_requests,
  enabled = excluded.enabled,
  effective_from = excluded.effective_from,
  updated_at = excluded.updated_at;
