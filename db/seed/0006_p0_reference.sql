-- P0 reference seed. Jurisdiction-specific values belong here, never in schema DDL.
insert into metric_definitions(metric_code, display_name, unit, allowed_dimensions)
values
  ('DOCTORS_REGISTERED', 'Doctors registered', 'COUNT', array['doctor_id','period_start']),
  ('APPOINTMENTS_BOOKED', 'Appointments booked', 'COUNT', array['doctor_id','practice_location_id','period_start']),
  ('CONSULTATIONS_COMPLETED', 'Consultations completed', 'COUNT', array['doctor_id','practice_location_id','period_start']),
  ('PRESCRIPTIONS_FINALIZED', 'Prescriptions finalized', 'COUNT', array['doctor_id','practice_location_id','period_start'])
on conflict (metric_code) do nothing;

insert into metric_classification_registry(classification_code)
values ('STANDARD'), ('CORRECTION')
on conflict do nothing;