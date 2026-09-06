-- ---------------------------------------------------------------------------
-- P1 additive parity hardening for the accepted V2 immutable-successor model.
--
-- Prerequisite: accepted P0/V2 prescription substrate plus the accepted P1
-- sequence through 0013. This file is deliberately NOT wired into the frozen
-- P0 manifest and does not activate or cut over V2.
--
-- Unlike the current runtime path, accepted V2 correction successors preserve
-- the V2 contract of copying prescription_items. Only the correction-initiation
-- time boundary is added here.
-- ---------------------------------------------------------------------------

create or replace function public.create_prescription_correction(
  original_key uuid,
  reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  doctor        uuid := public.current_doctor_id();
  original      public.prescriptions%rowtype;
  result        uuid;
  authorized_at timestamptz;
begin
  if doctor is null
     or not public.has_capability(public.current_profile_id(), 'DOCTOR') then
    raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode = '42501';
  end if;

  -- Serialize on the predecessor before reading any canonical state used for
  -- correction authorization. Waiting time therefore cannot extend the window.
  perform pg_advisory_xact_lock(
    hashtextextended('rx:correct:' || original_key::text, 0)
  );

  select * into original
  from public.prescriptions
  where id = original_key
    and owner_doctor_id = doctor
    and status = 'FINALIZED'
  for update;

  if not found then
    raise exception 'PRESCRIPTION_NOT_FOUND' using errcode = '42501';
  end if;

  if original.finalized_at is null then
    raise exception 'PRESCRIPTION_FINALIZATION_STATE_INVALID' using errcode = 'P0001';
  end if;

  -- Wall-clock DB time is sampled after serialization/canonical re-read. Using
  -- `>` means exactly +48:00:00 is still permitted.
  authorized_at := clock_timestamp();
  if authorized_at > original.finalized_at + interval '48 hours' then
    raise exception 'CORRECTION_WINDOW_EXPIRED' using errcode = 'P0001';
  end if;

  if nullif(btrim(reason), '') is null
     or char_length(btrim(reason)) > 500 then
    raise exception 'CORRECTION_REASON_REQUIRED' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.prescriptions
    where replaces_prescription_id = original_key
  ) then
    raise exception 'PRESCRIPTION_ALREADY_CORRECTED' using errcode = 'P0001';
  end if;

  insert into public.prescriptions (
    encounter_id,
    owner_doctor_id,
    clinical_patient_id,
    practice_location_id,
    replaces_prescription_id,
    replacement_reason
  ) values (
    original.encounter_id,
    doctor,
    original.clinical_patient_id,
    original.practice_location_id,
    original_key,
    btrim(reason)
  )
  returning id into result;

  -- Accepted V2 behaviour: the correction successor copies the predecessor's
  -- medicine rows. This is intentionally different from the current runtime
  -- blank-successor contract and is preserved unchanged here.
  insert into public.prescription_items (
    prescription_id,
    display_name,
    brand_name,
    generic_name,
    strength_text,
    dose_text,
    dosage_form,
    route,
    schedule_text,
    duration_text,
    quantity_text,
    food_relation,
    is_prn,
    instructions,
    substitution_allowed,
    position
  )
  select
    result,
    display_name,
    brand_name,
    generic_name,
    strength_text,
    dose_text,
    dosage_form,
    route,
    schedule_text,
    duration_text,
    quantity_text,
    food_relation,
    is_prn,
    instructions,
    substitution_allowed,
    position
  from public.prescription_items
  where prescription_id = original_key
  order by position;

  insert into public.prescription_events (prescription_id, event, actor_kind, actor_id)
  values (result, 'CORRECTION_STARTED', 'USER', public.current_profile_id());

  perform public.emit_audit_event(
    'PRESCRIPTION_CORRECTION_STARTED',
    'prescriptions',
    result,
    null
  );

  return result;
exception
  when unique_violation then
    raise exception 'PRESCRIPTION_ALREADY_CORRECTED' using errcode = 'P0001';
end;
$$;

-- Re-definition must not widen the accepted P0 execute surface.
revoke all on function public.create_prescription_correction(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_prescription_correction(uuid, text)
  to authenticated;
