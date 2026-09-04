revoke create on schema public from public;
revoke create on schema public from authenticated, anon, dd_owner_analytics, dd_metrics_reader, dd_metrics_rollup, dd_public_ingress;

do $$ declare item record; begin
  for item in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', item.tablename);
    execute format('alter table public.%I force row level security', item.tablename);
  end loop;
end $$;

create policy profiles_self_read on profiles for select using (id = public.current_profile_id());
create policy professional_profiles_custodial_read on professional_profiles for select using (profile_id = public.current_profile_id());
create policy clinical_patients_owner_read on clinical_patients for select using (owner_doctor_id = public.current_doctor_id());
create policy encounters_owner_read on encounters for select using (owner_doctor_id = public.current_doctor_id());
create policy encounter_diagnoses_owner_read on encounter_diagnoses for select using (owner_doctor_id = public.current_doctor_id());
create policy encounter_investigations_owner_read on encounter_investigations for select using (owner_doctor_id = public.current_doctor_id());
create policy encounter_events_owner_read on encounter_events for select using (owner_doctor_id = public.current_doctor_id());
create policy prescriptions_owner_read on prescriptions for select using (owner_doctor_id = public.current_doctor_id());
create policy prescription_items_owner_read on prescription_items for select using (
  exists (select 1 from prescriptions p where p.id = prescription_items.prescription_id and p.owner_doctor_id = public.current_doctor_id())
);
create policy prescription_events_owner_read on prescription_events for select using (
  exists (select 1 from prescriptions p where p.id = prescription_events.prescription_id and p.owner_doctor_id = public.current_doctor_id())
);
create policy practice_locations_member_read on practice_locations for select using (
  exists (select 1 from practice_memberships pm where pm.practice_location_id = practice_locations.id and pm.profile_id = public.current_profile_id() and pm.status = 'ACTIVE')
);
create policy practice_memberships_self_read on practice_memberships for select using (profile_id = public.current_profile_id());
create policy appointments_owner_read on appointments for select using (owner_doctor_id = public.current_doctor_id());

create policy public_booking_contacts_operational_read
on public_booking_contacts
for select
using (
  public.can_read_public_booking_contact(
    public_booking_contacts.appointment_id
  )
);

create policy appointment_events_owner_read on appointment_events for select using (
  exists (select 1 from appointments a where a.id = appointment_events.appointment_id and a.owner_doctor_id = public.current_doctor_id())
);
create policy queue_entries_owner_read on queue_entries for select using (
  exists (select 1 from appointments a where a.id = queue_entries.appointment_id and a.owner_doctor_id = public.current_doctor_id())
);
create policy doctor_chambers_owner_read on doctor_chambers for select using (doctor_id = public.current_doctor_id());
create policy doctor_chamber_hours_owner_read on doctor_chamber_hours for select using (
  exists (select 1 from doctor_chambers c where c.id = doctor_chamber_hours.doctor_chamber_id and c.doctor_id = public.current_doctor_id())
);
create policy health_subject_access_self_read on health_subject_access for select using (profile_id = public.current_profile_id());
create policy health_subjects_access_read on health_subjects for select using (
  exists (select 1 from health_subject_access a where a.health_subject_id = health_subjects.id and a.profile_id = public.current_profile_id() and public.is_live_edge(a.effective_from, a.expires_at, a.revoked_at))
);
create policy consent_subject_read on consent_records for select using (
  exists (select 1 from health_subject_access a where a.health_subject_id = consent_records.health_subject_id and a.profile_id = public.current_profile_id() and public.is_live_edge(a.effective_from, a.expires_at, a.revoked_at))
);
create policy audit_events_actor_read on audit_events for select using (actor_id = public.current_profile_id());
create policy metric_rollups_no_direct_read on metric_rollups for select using (false);

revoke all on all tables in schema public from anon, authenticated, dd_public_ingress;
revoke all on all sequences in schema public from anon, authenticated, dd_public_ingress;