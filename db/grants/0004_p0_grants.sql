revoke all on all tables in schema public from public, anon, authenticated, service_role, dd_owner_analytics, dd_metrics_reader, dd_metrics_rollup, dd_public_ingress;
revoke all on all sequences in schema public from public, anon, authenticated, service_role, dd_owner_analytics, dd_metrics_reader, dd_metrics_rollup, dd_public_ingress;
revoke all on all functions in schema public from public, anon, authenticated, service_role, dd_owner_analytics, dd_metrics_reader, dd_metrics_rollup, dd_public_ingress;

grant select on profiles, professional_profiles, professional_credentials, health_subjects, health_subject_access, consent_records to authenticated;
grant select on audit_events to authenticated;
grant select on clinical_patients, encounters, encounter_diagnoses, encounter_investigations, encounter_events,
  prescriptions, prescription_items, prescription_events, prescription_templates, appointments, appointment_events, queue_entries, queue_events,
  practice_locations, practice_memberships, doctor_chambers, doctor_chamber_hours, public_booking_contacts to authenticated;
grant select on metric_rollups to dd_metrics_reader;
grant select on metric_contributions to dd_metrics_rollup;
grant select, insert, update, delete on metric_rollups to dd_metrics_rollup;
grant execute on function public.rebuild_metric_rollups(date) to dd_metrics_rollup;

grant execute on function public.current_profile_id(), public.current_doctor_id(), public.has_capability(uuid, capability), public.is_live_edge(timestamptz, timestamptz, timestamptz) to authenticated;
grant execute on function public.normalize_dd_number(text), public.dd_check_symbol(text) to authenticated;
grant execute on function public.emit_audit_event(text, text, uuid, uuid) to authenticated;
grant execute on function public.create_professional_profile(text, profession), public.create_health_subject(text, subject_kind, text),
  public.create_clinical_patient(text, uuid), public.open_encounter(uuid, uuid), public.open_prescription(uuid) to authenticated;
grant execute on function public.allocate_dd_patient_number() to authenticated;
grant execute on function public.finalize_prescription(uuid, integer, jsonb, text, text), public.allocate_queue_token(uuid, date, uuid) to authenticated;

grant execute on function
  public.can_read_public_booking_contact(uuid),
  public.correct_public_booking_contact(uuid, text, text, text, text),
  public.search_public_booking_patient_candidates(uuid, text, text),
  public.resolve_public_booking_patient(uuid, uuid),
  public.register_public_booking_patient(uuid, text, text, text)
to authenticated;

-- P0 clinical/practice mutation surface. All ownership and authority are derived
-- server-side by the SECURITY DEFINER functions; tables remain read-only.
grant execute on function
  public.open_encounter_for_appointment(uuid),
  public.update_encounter_sections(uuid, integer, text, text, text, text, text, text),
  public.finish_consultation(uuid, integer),
  public.add_encounter_diagnosis(uuid, integer, text),
  public.add_encounter_investigation(uuid, integer, text),
  public.add_prescription_item(uuid, integer, jsonb),
  public.prescription_review_bundle(uuid),
  public.create_prescription_correction(uuid, text),
  public.handover_prescription(uuid),
  public.create_prescription_template(text, jsonb),
  public.update_prescription_template(uuid, text, jsonb, boolean),
  public.update_professional_profile(text, text, text, text, text)
to authenticated;

grant execute on function
  public.create_internal_appointment(uuid, uuid, timestamptz, appointment_mode),
  public.reschedule_appointment(uuid, timestamptz),
  public.set_appointment_status(uuid, appointment_status, text),
  public.cancel_appointment(uuid, cancellation_reason, text),
  public.check_in_appointment(uuid),
  public.call_patient(uuid, text),
  public.skip_patient(uuid, text),
  public.set_queue_priority(uuid, priority_reason, text),
  public.clear_queue_priority(uuid),
  public.create_walkin_appointment(uuid, text)
to authenticated;

grant execute on function
  public.grant_health_subject_access(uuid, uuid, subject_authority, text),
  public.revoke_health_subject_access(uuid, text),
  public.prepare_doctor_asset(text),
  public.prepare_prescription_signature_asset(uuid),
  public.may_write_doctor_asset(text, text),
  public.may_read_prescription_asset(text)
to authenticated;


-- ---------------------------------------------------------------------------
-- P0 anonymous surface: exact three RPCs, and no table SELECT.
-- ---------------------------------------------------------------------------

grant execute on function
  public.public_chamber_availability(uuid, date, date),
  public.create_public_booking(uuid, timestamptz, text, text, text, text),
  public.public_booking_status(uuid)
to anon;

-- Trusted application ingress has no table authority. It may only establish
-- trusted transaction context, invoke the same three RPCs, and record the
-- bounded fallback INTERNAL_FAILURE audit in a separate transaction.
grant execute on function
  public.set_public_ingress_context(uuid, timestamptz, bytea, bytea, bytea, appointment_source, uuid),
  public.public_chamber_availability(uuid, date, date),
  public.create_public_booking(uuid, timestamptz, text, text, text, text),
  public.public_booking_status(uuid),
  public.record_public_ingress_failure(text, uuid, uuid)
to dd_public_ingress;

-- ---------------------------------------------------------------------------
-- Supabase's built-in service_role receives broad default function EXECUTE
-- ACLs on the substrate. DD-owned SECURITY DEFINER functions must not inherit
-- that as an undeclared shortcut. Revoke only these exact Doctor's Diary
-- functions; do not alter Supabase-owned/system functions globally.
-- ---------------------------------------------------------------------------

revoke execute on function public.allocate_dd_patient_number() from service_role;
revoke execute on function public.current_profile_id() from service_role;
revoke execute on function public.current_doctor_id() from service_role;
revoke execute on function public.has_capability(uuid, capability) from service_role;
revoke execute on function public.refresh_profile_capabilities(uuid) from service_role;
revoke execute on function public.refresh_capability_trigger() from service_role;
revoke execute on function public.create_professional_profile(text, profession) from service_role;
revoke execute on function public.emit_audit_event(text, text, uuid, uuid) from service_role;
revoke execute on function public.create_health_subject(text, subject_kind, text) from service_role;
revoke execute on function public.create_clinical_patient(text, uuid) from service_role;
revoke execute on function public.open_encounter(uuid, uuid) from service_role;
revoke execute on function public.open_prescription(uuid) from service_role;
revoke execute on function public.finalize_prescription(uuid, integer, jsonb, text, text) from service_role;
revoke execute on function public.allocate_queue_token(uuid, date, uuid) from service_role;

revoke execute on function public.consume_anon_rate_limit(text) from service_role;
revoke execute on function public.emit_anon_audit_event(text, text, text, uuid) from service_role;
revoke execute on function public.record_public_ingress_failure(text, uuid, uuid) from service_role;
revoke execute on function public.public_chamber_is_eligible(uuid) from service_role;
revoke execute on function public.public_slot_is_open(uuid, timestamptz, timestamptz) from service_role;
revoke execute on function public.lock_public_booking_chamber(uuid) from service_role;
revoke execute on function public.public_chamber_availability(uuid, date, date) from service_role;
revoke execute on function public.create_public_booking(uuid, timestamptz, text, text, text, text) from service_role;
revoke execute on function public.public_booking_status(uuid) from service_role;
revoke execute on function public.can_read_public_booking_contact(uuid) from service_role;
revoke execute on function public.correct_public_booking_contact(uuid, text, text, text, text) from service_role;
revoke execute on function public.search_public_booking_patient_candidates(uuid, text, text) from service_role;
revoke execute on function public.resolve_public_booking_patient(uuid, uuid) from service_role;
revoke execute on function public.register_public_booking_patient(uuid, text, text, text) from service_role;

revoke execute on function public.record_p0_metric_contribution(text, metric_source_object_kind, uuid, text, integer, date, uuid, uuid, integer, text) from service_role;
revoke execute on function public.refresh_metric_rollups_after_contribution() from service_role;

revoke execute on function public.rebuild_metric_rollups(date) from service_role;
