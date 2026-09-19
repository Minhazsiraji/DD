create or replace function public.staff_reschedule_appointment(
  target_appointment_id uuid,
  target_location_id uuid,
  target_scheduled_for timestamptz,
  target_duration_minutes integer default null,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_new_id uuid;
  v_session_day date;
begin
  perform public.require_aal2();
  select * into v_appointment
  from public.appointments
  where id = target_appointment_id
    and practice_location_id = target_location_id
  for update;
  if not found or not public.has_doctor_staff_permission(
    v_appointment.owner_doctor_id, target_location_id, 'appointments.manage'
  ) then
    raise exception 'STAFF_APPOINTMENT_NOT_FOUND' using errcode = '42501';
  end if;
  if v_appointment.status in ('COMPLETED','CANCELLED','NO_SHOW') then
    raise exception 'STAFF_APPOINTMENT_RESCHEDULE_INVALID' using errcode = '22023';
  end if;
  if target_scheduled_for is null then
    raise exception 'STAFF_APPOINTMENT_TIME_REQUIRED' using errcode = '22023';
  end if;

  update public.appointments
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancellation_reason = 'RESCHEDULED',
      cancellation_note = nullif(btrim(coalesce(target_note,'')),''),
      updated_at = now()
  where id = v_appointment.id;

  insert into public.appointment_events (
    appointment_id, practice_location_id, event_type,
    from_status, to_status, actor_id, note
  ) values (
    v_appointment.id, target_location_id, 'RESCHEDULED',
    v_appointment.status, 'CANCELLED', auth.uid(),
    nullif(btrim(coalesce(target_note,'')),'')
  );

  v_session_day := public.session_date_for(target_location_id, target_scheduled_for);
  insert into public.appointments (
    owner_doctor_id, practice_location_id, patient_id, scheduled_for,
    session_date, duration_minutes, visit_type, reason,
    rescheduled_from_id, created_by
  ) values (
    v_appointment.owner_doctor_id, target_location_id, v_appointment.patient_id,
    target_scheduled_for, v_session_day,
    coalesce(target_duration_minutes, v_appointment.duration_minutes),
    v_appointment.visit_type, v_appointment.reason,
    v_appointment.id, auth.uid()
  ) returning id into v_new_id;

  insert into public.appointment_events (
    appointment_id, practice_location_id, event_type, to_status, actor_id
  ) values (
    v_new_id, target_location_id, 'CREATED', 'SCHEDULED', auth.uid()
  );

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    target_location_id, auth.uid(), 'STAFF_APPOINTMENT_RESCHEDULED',
    'appointment', v_new_id,
    jsonb_build_object(
      'doctor_profile_id', v_appointment.owner_doctor_id,
      'rescheduled_from_id', v_appointment.id
    )
  );
  return v_new_id;
end;
$$;

create or replace function public.staff_queue_entry_for(
  target_appointment_id uuid,
  target_location_id uuid
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_entry public.queue_entries%rowtype;
begin
  perform public.require_aal2();
  select * into v_appointment
  from public.appointments
  where id = target_appointment_id
  for update;

  if not found
     or v_appointment.practice_location_id is distinct from target_location_id
     or v_appointment.status <> 'ARRIVED'
     or not public.has_doctor_staff_permission(
       v_appointment.owner_doctor_id, target_location_id, 'queue.manage'
     ) then
    raise exception 'STAFF_QUEUE_FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.queue_entries (
    appointment_id, practice_location_id, session_date
  ) values (
    v_appointment.id, v_appointment.practice_location_id,
    v_appointment.session_date
  )
  on conflict (appointment_id) do update set updated_at = now()
  returning * into v_entry;
  return v_entry;
end;
$$;

create or replace function public.staff_call_patient(
  target_appointment_id uuid,
  target_location_id uuid,
  target_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_was_skipped boolean;
  v_count integer;
  v_doctor_id uuid;
begin
  v_entry := public.staff_queue_entry_for(
    target_appointment_id, target_location_id
  );
  select a.owner_doctor_id into v_doctor_id
  from public.appointments a where a.id = target_appointment_id;
  v_was_skipped := v_entry.skipped_at is not null;

  update public.queue_entries
  set called_at = now(), call_count = call_count + 1,
      skipped_at = null, updated_at = now()
  where appointment_id = target_appointment_id
  returning call_count into v_count;

  insert into public.queue_events (
    appointment_id, practice_location_id, event_type, note, actor_id
  ) values (
    target_appointment_id, target_location_id,
    (case when v_was_skipped then 'RECALLED' else 'CALLED' end)::public.queue_event_type,
    nullif(btrim(coalesce(target_note,'')),''), auth.uid()
  );
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    target_location_id, auth.uid(), 'STAFF_QUEUE_CALLED',
    'appointment', target_appointment_id,
    jsonb_build_object('doctor_profile_id', v_doctor_id)
  );
  return v_count;
end;
$$;

create or replace function public.staff_skip_patient(
  target_appointment_id uuid,
  target_location_id uuid,
  target_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_count integer;
  v_doctor_id uuid;
begin
  v_entry := public.staff_queue_entry_for(
    target_appointment_id, target_location_id
  );
  if v_entry.skipped_at is not null then return v_entry.skip_count; end if;
  select a.owner_doctor_id into v_doctor_id
  from public.appointments a where a.id = target_appointment_id;

  update public.queue_entries
  set skipped_at = now(), skip_count = skip_count + 1, updated_at = now()
  where appointment_id = target_appointment_id
  returning skip_count into v_count;

  insert into public.queue_events (
    appointment_id, practice_location_id, event_type, note, actor_id
  ) values (
    target_appointment_id, target_location_id, 'SKIPPED',
    nullif(btrim(coalesce(target_note,'')),''), auth.uid()
  );
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    target_location_id, auth.uid(), 'STAFF_QUEUE_SKIPPED',
    'appointment', target_appointment_id,
    jsonb_build_object('doctor_profile_id', v_doctor_id)
  );
  return v_count;
end;
$$;

create or replace function public.staff_clear_queue_priority(
  target_appointment_id uuid,
  target_location_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_doctor_id uuid;
begin
  v_entry := public.staff_queue_entry_for(
    target_appointment_id, target_location_id
  );
  select a.owner_doctor_id into v_doctor_id
  from public.appointments a where a.id = target_appointment_id;

  update public.queue_entries
  set priority = 0,
      priority_reason = null,
      priority_note = null,
      priority_set_by = auth.uid(),
      updated_at = now()
  where appointment_id = target_appointment_id;

  insert into public.queue_events (
    appointment_id, practice_location_id, event_type, actor_id
  ) values (
    target_appointment_id, target_location_id,
    'PRIORITY_CLEARED', auth.uid()
  );
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    target_location_id, auth.uid(), 'STAFF_QUEUE_PRIORITY_CLEARED',
    'appointment', target_appointment_id,
    jsonb_build_object('doctor_profile_id', v_doctor_id)
  );
end;
$$;

create or replace function public.staff_get_queue(
  target_location_id uuid,
  target_session_date date
)
returns table(
  appointment_id uuid,
  patient_id uuid,
  patient_name text,
  patient_number text,
  owner_doctor_id uuid,
  doctor_name text,
  token_number integer,
  status public.appointment_status,
  visit_type public.visit_type,
  scheduled_for timestamptz,
  arrived_at timestamptz,
  called_at timestamptz,
  call_count integer,
  skipped_at timestamptz,
  skip_count integer,
  priority integer,
  priority_reason public.priority_reason,
  priority_note text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_aal2();
  if not public.managed_staff_entry_at(target_location_id) then
    raise exception 'STAFF_QUEUE_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select
    a.id, p.id, p.full_name, p.patient_number,
    a.owner_doctor_id, pr.full_name,
    a.token_number, a.status, a.visit_type,
    a.scheduled_for, a.arrived_at,
    q.called_at, coalesce(q.call_count,0),
    q.skipped_at, coalesce(q.skip_count,0),
    coalesce(q.priority,0), q.priority_reason, q.priority_note
  from public.appointments a
  join public.patients p on p.id = a.patient_id
  join public.doctor_profiles d on d.id = a.owner_doctor_id
  join public.profiles pr on pr.id = d.user_id
  left join public.queue_entries q on q.appointment_id = a.id
  where a.practice_location_id = target_location_id
    and a.session_date = target_session_date
    and a.status in ('ARRIVED','IN_CONSULTATION')
    and public.has_doctor_staff_permission(
      a.owner_doctor_id, target_location_id, 'queue.manage'
    )
  order by
    case when a.status = 'IN_CONSULTATION' then 0 else 1 end,
    case when q.skipped_at is not null then 1 else 0 end,
    coalesce(q.priority,0) desc,
    a.token_number asc nulls last;
end;
$$;

revoke all on function public.staff_reschedule_appointment(uuid,uuid,timestamptz,integer,text) from public;
revoke all on function public.staff_queue_entry_for(uuid,uuid) from public;
revoke all on function public.staff_call_patient(uuid,uuid,text) from public;
revoke all on function public.staff_skip_patient(uuid,uuid,text) from public;
revoke all on function public.staff_clear_queue_priority(uuid,uuid) from public;
revoke all on function public.staff_get_queue(uuid,date) from public;

grant execute on function public.staff_reschedule_appointment(uuid,uuid,timestamptz,integer,text) to authenticated;
grant execute on function public.staff_call_patient(uuid,uuid,text) to authenticated;
grant execute on function public.staff_skip_patient(uuid,uuid,text) to authenticated;
grant execute on function public.staff_clear_queue_priority(uuid,uuid) to authenticated;
grant execute on function public.staff_get_queue(uuid,date) to authenticated;
-- staff_queue_entry_for is internal to SECURITY DEFINER managed queue functions.
