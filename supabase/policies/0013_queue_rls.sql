-- =============================================================================
-- The live queue (Stage 5).
--
-- Reads follow the appointment they belong to, so the queue can never show a
-- patient the appointment list would hide. Writes go through RPCs only — the
-- same lockdown as Stage 4, for the same reason: RLS decides which rows you may
-- touch, never which code path touches them.
-- =============================================================================

alter table public.queue_entries enable row level security;
alter table public.queue_entries force  row level security;
alter table public.queue_events  enable row level security;
alter table public.queue_events  force  row level security;

revoke all on public.queue_entries from anon;
revoke all on public.queue_events  from anon;

/**
 * Visibility is inherited from the appointment, deliberately.
 *
 * Restating the rule here would be a second copy that can drift from
 * appointments_select — and the queue is the screen where being wrong is
 * visible to a whole waiting room.
 */
drop policy if exists queue_entries_select on public.queue_entries;
create policy queue_entries_select
  on public.queue_entries for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and (
          a.owner_doctor_id = public.current_doctor_id()
          or public.runs_front_desk_at(a.practice_location_id)
        )
    )
  );

drop policy if exists queue_events_select on public.queue_events;
create policy queue_events_select
  on public.queue_events for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and (
          a.owner_doctor_id = public.current_doctor_id()
          or public.runs_front_desk_at(a.practice_location_id)
        )
    )
  );

-- Writes are RPC-only. The revokes are not redundant: Supabase's default
-- privileges hand `authenticated` every verb on a new table, so omitting one
-- from a GRANT does not remove it.
grant select on public.queue_entries to authenticated;
grant select on public.queue_events  to authenticated;
revoke insert, update, delete on public.queue_entries from authenticated;
revoke insert, update, delete on public.queue_events  from authenticated;

-- -----------------------------------------------------------------------------
-- The queue itself: a projection over appointments.
-- -----------------------------------------------------------------------------

/**
 * Everyone in the room, in the order they will be seen.
 *
 * Membership is derived — ARRIVED means waiting, IN_CONSULTATION means with the
 * doctor. There is no queue status to fall out of step (ADR 0009).
 *
 * SECURITY INVOKER: RLS on the underlying tables does the filtering, so a
 * receptionist sees their location and a doctor sees their own patients
 * wherever they work, with no rule restated here.
 */
create or replace function public.get_queue(
  p_practice_location_id uuid,
  p_session_date         date
)
returns table (
  appointment_id   uuid,
  patient_id       uuid,
  patient_name     text,
  patient_number   text,
  owner_doctor_id  uuid,
  doctor_name      text,
  token_number     integer,
  status           public.appointment_status,
  visit_type       public.visit_type,
  scheduled_for    timestamptz,
  arrived_at       timestamptz,
  called_at        timestamptz,
  call_count       integer,
  skipped_at       timestamptz,
  skip_count       integer,
  priority         integer,
  priority_reason  public.priority_reason,
  priority_note    text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    a.id, p.id, p.full_name, p.patient_number,
    a.owner_doctor_id, pr.full_name,
    a.token_number, a.status, a.visit_type, a.scheduled_for, a.arrived_at,
    q.called_at, coalesce(q.call_count, 0),
    q.skipped_at, coalesce(q.skip_count, 0),
    coalesce(q.priority, 0), q.priority_reason, q.priority_note
  from public.appointments a
  join public.patients p        on p.id  = a.patient_id
  join public.doctor_profiles d on d.id  = a.owner_doctor_id
  join public.profiles pr       on pr.id = d.user_id
  left join public.queue_entries q on q.appointment_id = a.id
  where a.practice_location_id = p_practice_location_id
    and a.session_date         = p_session_date
    and a.status in ('ARRIVED', 'IN_CONSULTATION')
  order by
    -- With the doctor first: that row is the one the screen is about.
    case when a.status = 'IN_CONSULTATION' then 0 else 1 end,
    -- Skipped patients drop out of the main line until someone recalls them.
    case when q.skipped_at is not null then 1 else 0 end,
    coalesce(q.priority, 0) desc,
    a.token_number asc nulls last;
$$;

revoke all on function public.get_queue(uuid, date) from public, anon;
grant execute on function public.get_queue(uuid, date) to authenticated;
