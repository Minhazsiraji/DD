-- =============================================================================
-- Encounters (Stage 6A) — the clinical read boundary.
--
-- THE RULE, in one sentence: only the OWNING DOCTOR reads clinical content.
--
-- Not reception. Not the location administrator. Not a colleague doctor at the
-- same hospital — this product has no care-team sharing rule (ADR 0001), so
-- there is nothing to honour and nothing to widen for.
--
-- Reception's legitimate need is operational — has the consultation started,
-- is it finished — and that is served by a narrow FUNCTION returning a status,
-- never by a row from these tables. Granting the row and hiding fields in the
-- UI is not a boundary: RLS filters rows, not columns. That lesson cost a
-- rebuild in Stage 3 and is not being relearned here.
-- =============================================================================

alter table public.encounters               enable row level security;
alter table public.encounters               force  row level security;
alter table public.encounter_diagnoses      enable row level security;
alter table public.encounter_diagnoses      force  row level security;
alter table public.encounter_investigations enable row level security;
alter table public.encounter_investigations force  row level security;
alter table public.encounter_events         enable row level security;
alter table public.encounter_events         force  row level security;

revoke all on public.encounters               from anon;
revoke all on public.encounter_diagnoses      from anon;
revoke all on public.encounter_investigations from anon;
revoke all on public.encounter_events         from anon;

/**
 * Does the caller own this encounter?
 *
 * SECURITY DEFINER so the child-table policies can ask without needing their
 * own read access to `encounters`; it answers one boolean and leaks nothing.
 */
create or replace function public.owns_encounter(target_encounter uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.encounters e
    where e.id = target_encounter
      and e.owner_doctor_id = public.current_doctor_id()
  );
$$;

revoke all on function public.owns_encounter(uuid) from public, anon;
grant execute on function public.owns_encounter(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- READ policies — owning doctor only, on every table.
-- -----------------------------------------------------------------------------
drop policy if exists encounters_select on public.encounters;
create policy encounters_select
  on public.encounters for select to authenticated
  using (owner_doctor_id = public.current_doctor_id());

drop policy if exists encounter_diagnoses_select on public.encounter_diagnoses;
create policy encounter_diagnoses_select
  on public.encounter_diagnoses for select to authenticated
  using (public.owns_encounter(encounter_id));

drop policy if exists encounter_investigations_select on public.encounter_investigations;
create policy encounter_investigations_select
  on public.encounter_investigations for select to authenticated
  using (public.owns_encounter(encounter_id));

drop policy if exists encounter_events_select on public.encounter_events;
create policy encounter_events_select
  on public.encounter_events for select to authenticated
  using (public.owns_encounter(encounter_id));

-- -----------------------------------------------------------------------------
-- WRITES ARE RPC-ONLY.
--
-- Supabase's default privileges hand `authenticated` every verb on a new table,
-- so omitting a verb from a GRANT does not remove it. Each must be revoked, and
-- no write policy exists — one would advertise a direct path that must not be
-- taken and would let a future GRANT quietly re-open it.
-- -----------------------------------------------------------------------------
grant select on public.encounters               to authenticated;
grant select on public.encounter_diagnoses      to authenticated;
grant select on public.encounter_investigations to authenticated;
grant select on public.encounter_events         to authenticated;

revoke insert, update, delete on public.encounters               from authenticated;
revoke insert, update, delete on public.encounter_diagnoses      from authenticated;
revoke insert, update, delete on public.encounter_investigations from authenticated;
revoke insert, update, delete on public.encounter_events         from authenticated;

-- -----------------------------------------------------------------------------
-- One active draft. Enforced by the DATABASE, not by an application check —
-- two tabs and a double-click are the normal case, not the exception.
-- -----------------------------------------------------------------------------
create unique index if not exists encounters_one_draft_per_appointment
  on public.encounters (appointment_id)
  where status = 'DRAFT' and appointment_id is not null;

/**
 * LOCATION IS PART OF THE IDENTITY.
 *
 * An encounter is one doctor, one patient, one LOCATION, one occasion. Keying
 * the unscheduled draft on (doctor, patient) alone meant opening that patient
 * at the chamber could hand back the draft started at the hospital — and every
 * subsequent write would then fail the location check, leaving the doctor in a
 * consultation they could not save. Same patient, same doctor, different place
 * is a different occasion.
 */
drop index if exists public.encounters_one_unscheduled_draft;

create unique index if not exists encounters_one_unscheduled_draft_at_location
  on public.encounters (owner_doctor_id, patient_id, practice_location_id)
  where status = 'DRAFT' and appointment_id is null;

-- -----------------------------------------------------------------------------
-- What reception may know: the operational fact, and nothing else.
-- -----------------------------------------------------------------------------

/**
 * Has the consultation started, is it running, is it done?
 *
 * Returns a STATUS and timestamps. No complaint, no history, no examination, no
 * diagnosis, no investigation, no advice, no note — the columns are simply not
 * in the result, so there is nothing for a UI mistake to reveal.
 *
 * SECURITY DEFINER because the caller cannot read `encounters` at all. Every
 * rule it bypasses is restated: the caller must run the front desk at the
 * appointment's location, or own the encounter.
 */
create or replace function public.encounter_status_for_appointment(
  p_appointment_id uuid,
  p_practice_location_id uuid
)
returns table (
  encounter_id uuid,
  status       public.encounter_status,
  started_at   timestamptz,
  completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_appt public.appointments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_appt from public.appointments where id = p_appointment_id;

  -- Same answer whether it is missing, not yours, or somewhere else: which
  -- appointment ids exist and where is not something to probe for.
  if not found
     or v_appt.practice_location_id is distinct from p_practice_location_id
     or not (
       public.runs_front_desk_at(v_appt.practice_location_id)
       or v_appt.owner_doctor_id = public.current_doctor_id()
     ) then
    raise exception 'appointment not found' using errcode = '42501';
  end if;

  return query
    select e.id, e.status, e.started_at, e.completed_at
    from public.encounters e
    where e.appointment_id = p_appointment_id
    order by e.started_at desc
    limit 1;
end;
$$;

revoke all on function public.encounter_status_for_appointment(uuid, uuid) from public, anon;
grant execute on function public.encounter_status_for_appointment(uuid, uuid) to authenticated;
