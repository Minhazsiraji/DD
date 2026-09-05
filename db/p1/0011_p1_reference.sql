-- Doctor's Diary Database V2, P1 reference data.
-- Registry rows declare bounded health-signal identities only; no future-domain source is implemented here.

insert into public.health_signal_registry(signal_code, expected_interval, is_active)
values
  ('PROVIDER_ERROR_RATE', interval '15 minutes', true),
  ('PROVIDER_EVENT_BACKLOG', interval '5 minutes', true),
  ('NOTIFICATION_DELIVERY_FAILURE_RATE', interval '15 minutes', true),
  ('MEDICINE_IMPORT_RUN_STATUS', interval '24 hours', true),
  ('CAPABILITY_PROJECTION_LAG', interval '5 minutes', true),
  ('AUTH_FAILURE_RATE', interval '15 minutes', true),
  ('STORAGE_OBJECT_COUNT', interval '1 hour', true),
  ('DB_SIZE', interval '1 hour', true),
  ('VERIFIER_SUITE_STATUS', interval '24 hours', true)
on conflict (signal_code) do update set
  expected_interval=excluded.expected_interval,
  is_active=excluded.is_active;
