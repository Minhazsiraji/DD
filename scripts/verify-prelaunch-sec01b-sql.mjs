import fs from "node:fs/promises";
import postgres from "postgres";

const url = process.env.SEC01B_TEST_DATABASE_URL;
if (!url) throw new Error("SEC01B_TEST_DATABASE_URL is required");

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const migration = await fs.readFile(
  "supabase/policies/0045_prelaunch_sec01b_security_closure.sql",
  "utf8",
);

const clinicalTables = [
  "appointment_events",
  "appointments",
  "encounter_diagnoses",
  "encounter_events",
  "encounter_investigations",
  "encounters",
  "patient_alerts",
  "patient_allergies",
  "patient_conditions",
  "patient_contacts",
  "patient_documents",
  "patient_location_links",
  "patient_medications",
  "patient_private_notes",
  "patients",
  "prescription_events",
  "prescription_items",
  "prescriptions",
  "queue_entries",
  "queue_events",
];

const guarded = [
  "create_appointment",
  "reschedule_appointment",
  "set_appointment_status",
  "may_manage_appointments",
  "encounter_status_for_appointment",
  "call_patient",
  "skip_patient",
  "set_queue_priority",
  "clear_queue_priority",
  "can_access_patient",
  "can_access_patient_as",
  "check_walkin_duplicates",
  "find_duplicates_for_doctor",
  "may_see_patient",
  "owns_patient",
  "register_patient_for_doctor",
  "create_patient_document",
  "archive_patient_document",
  "restore_patient_document",
  "owns_patient_document",
  "open_encounter",
  "may_open_encounter",
  "save_encounter_sections",
  "add_encounter_diagnosis",
  "update_encounter_diagnosis",
  "remove_encounter_diagnosis",
  "add_encounter_investigation",
  "update_encounter_investigation",
  "remove_encounter_investigation",
  "close_encounter",
  "finish_consultation",
  "owns_encounter",
  "open_prescription",
  "add_prescription_item",
  "update_prescription_item",
  "remove_prescription_item",
  "move_prescription_item",
  "finalize_prescription",
  "prescription_detail",
  "finalized_prescription_detail",
  "finalized_prescriptions_at",
  "prescriptions_for_doctor",
  "patient_prescription_history",
  "prescription_review_bundle",
  "prescription_lineage",
  "prescription_owner_location",
  "prescription_frozen_signature_path",
  "prescription_item_suggestions",
  "owns_prescription",
  "may_hand_over_prescription",
  "may_read_prescription_asset",
  "start_prescription_correction",
  "reuse_finalized_prescription_items",
  "prescription_signed_medicine_history",
  "initiate_prescription_print",
  "confirm_prescription_print",
  "prescription_print_history",
  "owner_pending_claims",
  "owner_pending_payments",
  "owner_decide_doctor_profile_claim",
  "owner_decide_subscription_payment",
];

if (guarded.length !== 61) throw new Error(`guarded fixture drift: ${guarded.length}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function setup() {
  await sql.unsafe(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    create schema public;
    create schema auth;
    grant usage on schema public to public;

    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
    end $$;

    grant usage on schema public, auth to anon, authenticated, service_role;

    create function auth.jwt() returns jsonb
    language sql stable
    as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
  `);

  for (const table of clinicalTables) {
    await sql.unsafe(`
      create table public.${table} (id integer primary key);
      insert into public.${table}(id) values (1);
      alter table public.${table} enable row level security;
      alter table public.${table} force row level security;
      grant select, insert, update, delete on public.${table} to authenticated;
      create policy baseline_access on public.${table}
        for all to authenticated using (true) with check (true);
    `);
  }

  // Exercise both migration injection branches: first eleven SQL functions,
  // remaining functions PL/pgSQL. Every function is SECURITY DEFINER and
  // authenticated-executable, exactly the inventory filter used by 0045.
  for (const [index, name] of guarded.entries()) {
    if (index < 11) {
      await sql.unsafe(`
        create function public.${name}() returns text
        language sql stable security definer set search_path=public,pg_temp
        as $$ select 'ok'::text $$;
        grant execute on function public.${name}() to authenticated;
      `);
    } else {
      await sql.unsafe(`
        create function public.${name}() returns text
        language plpgsql stable security definer set search_path=public,pg_temp
        as $$ begin return 'ok'; end $$;
        grant execute on function public.${name}() to authenticated;
      `);
    }
  }

  await sql.unsafe(`
    create function public.cancel_own_subscription() returns text language sql security definer as $$ select 'ok'::text $$;
    create function public.current_subscription() returns text language sql security definer as $$ select 'ok'::text $$;
    create function public.ensure_doctor_subscription() returns text language sql security definer as $$ select 'ok'::text $$;
    create function public.reactivate_own_subscription() returns text language sql security definer as $$ select 'ok'::text $$;
    create function public.submit_manual_subscription_payment(numeric,text,text) returns text language sql security definer as $$ select 'ok'::text $$;

    grant execute on function public.cancel_own_subscription() to anon, authenticated;
    grant execute on function public.current_subscription() to anon, authenticated;
    grant execute on function public.ensure_doctor_subscription() to anon, authenticated;
    grant execute on function public.reactivate_own_subscription() to anon, authenticated;
    grant execute on function public.submit_manual_subscription_payment(numeric,text,text) to anon, authenticated;

    create function public.public_doctor_profile(text) returns text language sql security definer as $$ select 'public'::text $$;
    create function public.public_booking_slots(text,uuid,date) returns text language sql security definer as $$ select 'public'::text $$;
    create function public.create_public_booking(text,uuid,date,text,text,text,text,text) returns text language sql security definer as $$ select 'public'::text $$;
    create function public.public_booking_confirmation(text,uuid) returns text language sql security definer as $$ select 'public'::text $$;

    grant execute on function public.public_doctor_profile(text) to anon, authenticated;
    grant execute on function public.public_booking_slots(text,uuid,date) to anon, authenticated;
    grant execute on function public.create_public_booking(text,uuid,date,text,text,text,text,text) to anon, authenticated;
    grant execute on function public.public_booking_confirmation(text,uuid) to anon, authenticated;

    create function public.slug_is_reserved(candidate text)
    returns boolean language sql immutable
    as $$ select candidate = any(array['admin','api','auth','patient','prescription','root','www']) $$;
  `);
}

async function asRole(role, claims, fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    return fn(tx);
  });
}

async function expectRejected(promiseFactory, pattern) {
  let rejected = false;
  try {
    await promiseFactory();
  } catch (error) {
    rejected = true;
    const message = error instanceof Error ? error.message : String(error);
    assert(pattern.test(message), `unexpected rejection: ${message}`);
  }
  assert(rejected, `expected rejection ${pattern}`);
}

try {
  await setup();
  await sql.unsafe(migration);

  const policyCount = await sql`
    select count(*)::int as n from pg_policies
    where schemaname='public' and policyname='sec01b_aal2_required'
  `;
  assert(policyCount[0].n === 20, `expected 20 restrictive policies, found ${policyCount[0].n}`);

  const guardedCount = await sql`
    select count(*)::int as n
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and position('public.require_aal2()' in pg_get_functiondef(p.oid)) > 0
      and p.proname = any(${guarded})
  `;
  assert(guardedCount[0].n === 61, `expected 61 guarded RPCs, found ${guardedCount[0].n}`);

  const aal1Rows = await asRole("authenticated", { aal: "aal1" }, (tx) => tx`select id from public.patients`);
  assert(aal1Rows.length === 0, "AAL1 direct clinical SELECT returned rows");

  const aal2Rows = await asRole("authenticated", { aal: "aal2" }, (tx) => tx`select id from public.patients`);
  assert(aal2Rows.length === 1, "AAL2 direct clinical SELECT lost authorized row");

  await expectRejected(
    () => asRole("authenticated", { aal: "aal1" }, (tx) => tx`insert into public.patients(id) values (2)`),
    /row-level security/i,
  );
  await asRole("authenticated", { aal: "aal2" }, (tx) => tx`insert into public.patients(id) values (2)`);

  await expectRejected(
    () => asRole("authenticated", { aal: "aal1" }, (tx) => tx`select public.open_encounter()`),
    /AAL2_REQUIRED/,
  );
  const plpgsqlOk = await asRole("authenticated", { aal: "aal2" }, (tx) => tx`select public.open_encounter() as v`);
  assert(plpgsqlOk[0].v === "ok", "AAL2 PL/pgSQL guarded RPC failed");

  await expectRejected(
    () => asRole("authenticated", { aal: "aal1" }, (tx) => tx`select public.create_appointment()`),
    /AAL2_REQUIRED/,
  );
  const sqlOk = await asRole("authenticated", { aal: "aal2" }, (tx) => tx`select public.create_appointment() as v`);
  assert(sqlOk[0].v === "ok", "AAL2 SQL guarded RPC failed");

  await expectRejected(
    () => asRole("authenticated", { aal: "aal1" }, (tx) => tx`select public.owner_decide_subscription_payment()`),
    /AAL2_REQUIRED/,
  );
  const ownerOk = await asRole("authenticated", { aal: "aal2" }, (tx) => tx`select public.owner_decide_subscription_payment() as v`);
  assert(ownerOk[0].v === "ok", "AAL2 owner decision failed");

  const publicOk = await asRole("anon", {}, (tx) => tx`select public.public_doctor_profile('doctor') as v`);
  assert(publicOk[0].v === "public", "intentional anon public profile broke");

  const acl = await sql`
    select
      has_function_privilege('anon','public.cancel_own_subscription()','EXECUTE') as anon_cancel,
      has_function_privilege('authenticated','public.cancel_own_subscription()','EXECUTE') as auth_cancel,
      has_function_privilege('anon','public.public_doctor_profile(text)','EXECUTE') as anon_public
  `;
  assert(acl[0].anon_cancel === false, "anon subscription EXECUTE still present");
  assert(acl[0].auth_cancel === true, "authenticated subscription EXECUTE was lost");
  assert(acl[0].anon_public === true, "intentional public EXECUTE was lost");

  const subscriptionOk = await asRole("authenticated", { aal: "aal1" }, (tx) => tx`select public.cancel_own_subscription() as v`);
  assert(subscriptionOk[0].v === "ok", "non-clinical authenticated subscription action was over-gated");

  const slug = await sql`
    select public.slug_is_reserved('admin') as reserved,
           public.slug_is_reserved('ordinary-doctor-slug') as ordinary,
           (select proconfig from pg_proc where oid='public.slug_is_reserved(text)'::regprocedure) as config
  `;
  assert(slug[0].reserved === true && slug[0].ordinary === false, "slug behavior changed");
  assert((slug[0].config ?? []).some((v) => /search_path=pg_catalog, public/.test(v)), "slug search_path not fixed");

  const publicGuardLeak = await sql`
    select count(*)::int as n
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(${[
        "public_doctor_profile",
        "public_booking_slots",
        "create_public_booking",
        "public_booking_confirmation",
      ]})
      and position('public.require_aal2()' in pg_get_functiondef(p.oid)) > 0
  `;
  assert(publicGuardLeak[0].n === 0, "public booking/profile function was AAL2-guarded");

  console.log("SEC01B_SQL_MECHANICS=PASS");
} finally {
  await sql.end();
}
