-- PRE-LAUNCH-SEC-01B-R1 — isolated security correction candidate.
-- FORWARD ONLY. Do not edit 0041–0044.
--
-- This file is intentionally reviewable without applying it remotely. It:
--   1. removes five unnecessary anon subscription/account grants;
--   2. fixes slug_is_reserved search_path without changing its behavior;
--   3. makes AAL2 authoritative for direct clinical table access;
--   4. rebuilds an explicit allowlist of existing clinical/control-plane
--      SECURITY DEFINER RPCs from structured PostgreSQL catalog metadata so an
--      AAL2 guard is added without regex/body-text surgery.
--
-- Public Doctor profile/booking RPCs are deliberately absent from the guarded
-- allowlist. Auth/MFA enrollment/challenge/recovery are Supabase Auth surfaces,
-- not public-schema RPCs, and are not affected by this migration.

-- ---------------------------------------------------------------------------
-- AAL2 authority primitives
-- ---------------------------------------------------------------------------

create or replace function public.session_is_aal2()
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke all on function public.session_is_aal2() from public, anon, authenticated, service_role;
grant execute on function public.session_is_aal2() to authenticated;

create or replace function public.require_aal2()
returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $$
begin
  if not public.session_is_aal2() then
    raise exception 'AAL2_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

-- Direct callers do not need this primitive; guarded SECURITY DEFINER functions
-- execute it as their owner. Keeping it non-callable removes an unnecessary API
-- surface without weakening the internal guard.
revoke all on function public.require_aal2() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Direct table access — restrictive AAL2 overlay
-- ---------------------------------------------------------------------------
-- Existing role/Doctor/location policies remain unchanged. These restrictive
-- policies add one orthogonal requirement: an authenticated clinical caller
-- must also have an AAL2 JWT. service_role is not targeted by these policies.

do $$
declare
  v_table text;
  v_tables constant text[] := array[
    'appointment_events',
    'appointments',
    'encounter_diagnoses',
    'encounter_events',
    'encounter_investigations',
    'encounters',
    'patient_alerts',
    'patient_allergies',
    'patient_conditions',
    'patient_contacts',
    'patient_documents',
    'patient_location_links',
    'patient_medications',
    'patient_private_notes',
    'patients',
    'prescription_events',
    'prescription_items',
    'prescriptions',
    'queue_entries',
    'queue_events'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'SEC01B expected clinical table is missing: %', v_table;
    end if;

    execute format('drop policy if exists sec01b_aal2_required on public.%I', v_table);
    execute format(
      'create policy sec01b_aal2_required on public.%I as restrictive for all to authenticated using (public.session_is_aal2()) with check (public.session_is_aal2())',
      v_table
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clinical/control-plane SECURITY DEFINER RPC authority
-- ---------------------------------------------------------------------------
-- The allowlist below is explicit on purpose. We do not infer "clinical" from
-- naming at migration time. The migration must see exactly 61 expected
-- authenticated SECURITY DEFINER functions or fail closed.
--
-- R1 deliberately DOES NOT manipulate pg_get_functiondef() text. Each target is
-- reconstructed from structured pg_proc / pg_get_function_* metadata and the
-- stored function source (prosrc). CREATE OR REPLACE preserves the function OID,
-- owner, ACL and dependent object identity because the name/input signature and
-- result type are unchanged. We also reproduce language, volatility, null-input
-- behavior, SECURITY DEFINER, parallel mode, cost/rows and the fixed search_path.
--
-- PL/pgSQL bodies are placed unchanged inside a nested block after the AAL2
-- check. A missing terminal block semicolon is added only as a syntactic
-- separator for nesting; no token inside the stored source is edited. This also
-- avoids PERFORM before the original block (which could alter FOUND).
-- SQL bodies receive one leading guard statement; the original final statement
-- remains the result-producing statement.

do $sec01b$
declare
  v_target_names constant text[] := array[
    'create_appointment',
    'reschedule_appointment',
    'set_appointment_status',
    'may_manage_appointments',
    'encounter_status_for_appointment',
    'call_patient',
    'skip_patient',
    'set_queue_priority',
    'clear_queue_priority',
    'can_access_patient',
    'can_access_patient_as',
    'check_walkin_duplicates',
    'find_duplicates_for_doctor',
    'may_see_patient',
    'owns_patient',
    'register_patient_for_doctor',
    'create_patient_document',
    'archive_patient_document',
    'restore_patient_document',
    'owns_patient_document',
    'open_encounter',
    'may_open_encounter',
    'save_encounter_sections',
    'add_encounter_diagnosis',
    'update_encounter_diagnosis',
    'remove_encounter_diagnosis',
    'add_encounter_investigation',
    'update_encounter_investigation',
    'remove_encounter_investigation',
    'close_encounter',
    'finish_consultation',
    'owns_encounter',
    'open_prescription',
    'add_prescription_item',
    'update_prescription_item',
    'remove_prescription_item',
    'move_prescription_item',
    'finalize_prescription',
    'prescription_detail',
    'finalized_prescription_detail',
    'finalized_prescriptions_at',
    'prescriptions_for_doctor',
    'patient_prescription_history',
    'prescription_review_bundle',
    'prescription_lineage',
    'prescription_owner_location',
    'prescription_frozen_signature_path',
    'prescription_item_suggestions',
    'owns_prescription',
    'may_hand_over_prescription',
    'may_read_prescription_asset',
    'start_prescription_correction',
    'reuse_finalized_prescription_items',
    'prescription_signed_medicine_history',
    'initiate_prescription_print',
    'confirm_prescription_print',
    'prescription_print_history',
    'owner_pending_claims',
    'owner_pending_payments',
    'owner_decide_doctor_profile_claim',
    'owner_decide_subscription_payment'
  ];
  v_expected constant integer := 61;
  v_seen integer := 0;
  v_guarded integer;
  r record;
  v_body text;
  v_ddl text;
  v_config text;
begin
  -- Catalog renderers below can emit public types without schema qualification.
  -- Pin migration-time name resolution locally; this does not alter any target
  -- function's own search_path, which is reconstructed exactly below.
  perform set_config('search_path', 'public, pg_temp', true);

  for r in
    select
      p.oid,
      p.proname,
      p.prokind,
      p.prosrc,
      p.provolatile,
      p.proisstrict,
      p.prosecdef,
      p.proleakproof,
      p.proparallel,
      p.procost,
      p.prorows,
      p.proretset,
      p.proconfig,
      p.prosupport,
      l.lanname,
      pg_get_function_arguments(p.oid) as arguments,
      pg_get_function_result(p.oid) as result_type
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(v_target_names)
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    order by p.proname, pg_get_function_identity_arguments(p.oid)
  loop
    v_seen := v_seen + 1;

    if r.prokind <> 'f' then
      raise exception 'SEC01B expected ordinary function for %, got prokind %', r.oid::regprocedure, r.prokind;
    end if;
    if r.lanname not in ('sql', 'plpgsql') then
      raise exception 'SEC01B unsupported guarded function language % for %', r.lanname, r.oid::regprocedure;
    end if;
    if not r.prosecdef then
      raise exception 'SEC01B target lost SECURITY DEFINER before repair: %', r.oid::regprocedure;
    end if;
    if r.proleakproof then
      raise exception 'SEC01B refuses unexpected LEAKPROOF target: %', r.oid::regprocedure;
    end if;
    if r.prosupport <> 0 then
      raise exception 'SEC01B refuses unexpected SUPPORT target: %', r.oid::regprocedure;
    end if;

    -- Live DD inventory currently pins every one of these 61 functions to this
    -- exact two-schema path. Fail closed rather than generically re-render an
    -- unexpected future GUC value and risk changing its semantics.
    if r.proconfig is distinct from array['search_path=public, pg_temp']::text[] then
      raise exception 'SEC01B unexpected function SET config for %: %', r.oid::regprocedure, r.proconfig;
    end if;
    v_config := E'\n SET search_path TO public, pg_temp';

    -- Idempotent re-run: a previously guarded body is left untouched.
    if position('public.require_aal2()' in r.prosrc) > 0
       or position('public.session_is_aal2()' in r.prosrc) > 0 then
      continue;
    end if;

    if r.lanname = 'plpgsql' then
      v_body :=
        E'begin\n'
        || E'  if not public.session_is_aal2() then\n'
        || E'    raise exception ''AAL2_REQUIRED'' using errcode = ''42501'';\n'
        || E'  end if;\n'
        || r.prosrc
        || case when right(btrim(r.prosrc, E' \t\n\r'), 1) = ';' then '' else ';' end
        || E'\nend;';
    else
      v_body := E'select public.require_aal2();\n' || r.prosrc;
    end if;

    v_ddl := format(
      E'create or replace function public.%I(%s)\n'
      || E'returns %s\n'
      || E'language %I\n'
      || E'%s\n'
      || E'%s\n'
      || E'security definer\n'
      || E'%s\n'
      || E'cost %s%s%s\n'
      || E'as %L',
      r.proname,
      r.arguments,
      r.result_type,
      r.lanname,
      case r.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
      case when r.proisstrict then 'returns null on null input' else 'called on null input' end,
      case r.proparallel when 's' then 'parallel safe' when 'r' then 'parallel restricted' else 'parallel unsafe' end,
      r.procost,
      case when r.proretset then format(' rows %s', r.prorows) else '' end,
      v_config,
      v_body
    );

    execute v_ddl;
  end loop;

  if v_seen <> v_expected then
    raise exception 'SEC01B guarded RPC inventory drift: expected %, found %', v_expected, v_seen;
  end if;

  select count(*)
  into v_guarded
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.proname = any(v_target_names)
    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and (
      position('public.require_aal2()' in p.prosrc) > 0
      or position('public.session_is_aal2()' in p.prosrc) > 0
    );

  if v_guarded <> v_expected then
    raise exception 'SEC01B AAL2 reconstruction verification failed: expected %, guarded %', v_expected, v_guarded;
  end if;
end;
$sec01b$;

-- ---------------------------------------------------------------------------
-- Five unintended anon subscription/account grants
-- ---------------------------------------------------------------------------

revoke execute on function public.cancel_own_subscription() from anon;
revoke execute on function public.current_subscription() from anon;
revoke execute on function public.ensure_doctor_subscription() from anon;
revoke execute on function public.reactivate_own_subscription() from anon;
revoke execute on function public.submit_manual_subscription_payment(numeric,text,text) from anon;

-- Intentional public Doctor profile/booking grants are deliberately untouched:
-- public_doctor_profile, public_booking_slots, create_public_booking,
-- public_booking_confirmation.

-- ---------------------------------------------------------------------------
-- slug_is_reserved search_path hardening
-- ---------------------------------------------------------------------------
-- The accepted/live function currently uses a hard-coded reserved-slug array;
-- it does not currently resolve reserved_public_slugs (that relation is absent
-- from the accepted source/live definition). Therefore there is no relation
-- reference to schema-qualify without changing behavior. Fix the mutable
-- search_path finding only, preserving IMMUTABLE semantics and the exact list.

create or replace function public.slug_is_reserved(candidate text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select candidate = any (array[
    'admin','api','app','auth','dashboard','doctor','doctors','dr','help',
    'login','logout','new','patient','patients','prescription','prescriptions',
    'profile','root','settings','signup','support','system','www'
  ]);
$$;
