revoke all on all tables in schema public from public, anon, authenticated, dd_owner_analytics, dd_metrics_reader, dd_metrics_rollup;
revoke all on all sequences in schema public from public, anon, authenticated, dd_owner_analytics, dd_metrics_reader, dd_metrics_rollup;
revoke all on all functions in schema public from public, anon, authenticated, dd_owner_analytics, dd_metrics_reader, dd_metrics_rollup;

grant select on profiles, professional_profiles, health_subjects, health_subject_access, consent_records to authenticated;
grant select on audit_events to authenticated;
grant select on clinical_patients, encounters, encounter_diagnoses, encounter_investigations, encounter_events,
  prescriptions, prescription_items, prescription_events, appointments, appointment_events, queue_entries,
  doctor_chambers, doctor_chamber_hours to authenticated;
grant select on metric_rollups to dd_metrics_reader;

grant execute on function public.current_profile_id(), public.current_doctor_id(), public.has_capability(uuid, capability), public.is_live_edge(timestamptz, timestamptz, timestamptz) to authenticated;
grant execute on function public.normalize_dd_number(text), public.dd_check_symbol(text) to authenticated;
grant execute on function public.emit_audit_event(text, text, uuid, uuid) to authenticated;
grant execute on function public.create_professional_profile(text, profession), public.create_health_subject(text, subject_kind, text),
  public.create_clinical_patient(text, uuid), public.open_encounter(uuid, uuid), public.open_prescription(uuid) to authenticated;
grant execute on function public.allocate_dd_patient_number() to authenticated;
grant execute on function public.refresh_profile_capabilities(uuid) to dd_metrics_rollup;
grant execute on function public.finalize_prescription(uuid, integer, jsonb, text, text), public.allocate_queue_token(uuid, date, uuid) to authenticated;