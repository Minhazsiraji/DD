-- =============================================================================
-- Prescriptions (Stage 7A) — the read boundary.
--
-- TWO audiences with genuinely different rights, which is why this is not a
-- copy of the encounter policy:
--
--   the OWNING DOCTOR   drafts and finalised, at every location they work in
--   RECEPTION / ADMIN   FINALISED ONLY, at the location it belongs to, and only
--                       for a patient they are already allowed to see
--
-- A DRAFT is a doctor thinking aloud. Handing it to the front desk is the same
-- mistake as handing over the clinical note. A colleague doctor who merely
-- shares a hospital gets nothing at all — ADR 0001 has no care-team rule to
-- appeal to.
-- =============================================================================

alter table public.prescriptions       enable row level security;
alter table public.prescriptions       force  row level security;
alter table public.prescription_items  enable row level security;
alter table public.prescription_items  force  row level security;
alter table public.prescription_events enable row level security;
alter table public.prescription_events force  row level security;

revoke all on public.prescriptions       from anon;
revoke all on public.prescription_items  from anon;
revoke all on public.prescription_events from anon;

/**
 * Does the caller own this prescription?
 *
 * SECURITY DEFINER so the child tables can ask without needing their own read
 * access to the parent; it answers one boolean and leaks nothing.
 */
create or replace function public.owns_prescription(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.prescriptions p
    where p.id = target and p.owner_doctor_id = public.current_doctor_id()
  );
$$;

/**
 * May the caller hand this prescription to the patient?
 *
 * Three conditions, all required:
 *   1. it is FINALISED — never a draft
 *   2. they run the front desk, or administer, THE LOCATION IT BELONGS TO
 *   3. they may already see that patient (the chamber boundary still applies)
 *
 * A DOCTOR role does not appear here on purpose. A colleague at the same
 * hospital holds no front-desk or admin duty over another doctor's paperwork,
 * and sharing a building is not a clinical relationship.
 */
create or replace function public.may_hand_over_prescription(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.prescriptions p
    where p.id = target
      and p.status = 'FINALIZED'
      and (
        public.runs_front_desk_at(p.practice_location_id)
        or public.has_location_role(p.practice_location_id, array['LOCATION_ADMIN']::public.location_role[])
      )
      and public.may_see_patient(p.patient_id)
  );
$$;

revoke all on function public.owns_prescription(uuid) from public, anon;
grant execute on function public.owns_prescription(uuid) to authenticated;
revoke all on function public.may_hand_over_prescription(uuid) from public, anon;
grant execute on function public.may_hand_over_prescription(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- READS ARE RPC-ONLY TOO, and that is the point.
--
-- A location-scoped read FUNCTION is not a boundary while the caller can also
-- `select * from prescriptions`. A receptionist with memberships at two clinics
-- would simply skip the function and read both — the scoping would be a
-- convention, not a rule. RLS filters ROWS by what a user MAY see; it cannot
-- express "…and only at the location you are working in right now", because
-- that is session state the database never sees.
--
-- So SELECT is revoked on the two tables that carry a location, and every read
-- goes through a function that takes the active location as an argument.
-- `prescription_events` keeps an ordinary policy: it is doctor-only and has no
-- location dimension to scope, so there is nothing for a direct read to bypass.
-- -----------------------------------------------------------------------------
drop policy if exists prescriptions_select on public.prescriptions;
drop policy if exists prescription_items_select on public.prescription_items;

/**
 * Clinical history is DOCTOR-ONLY, even for a finalised prescription. Reception
 * needs the paper, not the story of how it was written.
 */
drop policy if exists prescription_events_select on public.prescription_events;
create policy prescription_events_select
  on public.prescription_events for select to authenticated
  using (public.owns_prescription(prescription_id));

grant select on public.prescription_events to authenticated;

revoke select, insert, update, delete on public.prescriptions      from authenticated;
revoke select, insert, update, delete on public.prescription_items from authenticated;
revoke insert, update, delete on public.prescription_events        from authenticated;

-- -----------------------------------------------------------------------------
-- Write-once storage for finalised assets.
--
-- A finalised prescription references a signature by PATH, never by signed URL
-- — those expire, and a prescription that stops printing after an hour is not a
-- record. The object lives here, where nothing can update or delete it, so a
-- doctor later removing their profile signature cannot reach into a
-- prescription that was already approved.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('prescription-assets', 'prescription-assets', false)
on conflict (id) do nothing;

drop policy if exists prescription_assets_insert on storage.objects;
create policy prescription_assets_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'prescription-assets'
    -- prescription-assets/<doctor user id>/<prescription id>/<file>
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/**
 * Who may fetch a frozen signature.
 *
 * The doctor who owns it, and anyone entitled to hand the finalised
 * prescription over. Reception must be able to PRINT what they are allowed to
 * print — a policy that only let the owner read it would leave the signature
 * block blank on the one copy that matters.
 *
 * The prescription id is the SECOND path segment. Parsed defensively: an
 * unparseable name simply is not readable, rather than raising inside a policy
 * and taking the whole query down.
 */
create or replace function public.may_read_prescription_asset(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_parts text[] := storage.foldername(object_name);
  v_rx    uuid;
begin
  if array_length(v_parts, 1) is null or array_length(v_parts, 1) < 2 then
    return false;
  end if;
  if v_parts[1] = auth.uid()::text then
    return true;
  end if;
  begin
    v_rx := v_parts[2]::uuid;
  exception when others then
    return false;
  end;
  return public.may_hand_over_prescription(v_rx);
end;
$$;

revoke all on function public.may_read_prescription_asset(text) from public, anon;
grant execute on function public.may_read_prescription_asset(text) to authenticated;

drop policy if exists prescription_assets_select on storage.objects;
create policy prescription_assets_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'prescription-assets'
    and public.may_read_prescription_asset(name)
  );

/**
 * NO update policy and NO delete policy, deliberately.
 *
 * Not an omission — an omission would be a bug the next person "fixes". A
 * finalised prescription's signature must outlive every later change to the
 * doctor's profile, so nothing may overwrite or remove it, including its owner.
 */
drop policy if exists prescription_assets_update on storage.objects;
drop policy if exists prescription_assets_delete on storage.objects;
