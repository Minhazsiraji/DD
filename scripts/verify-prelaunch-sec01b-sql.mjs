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

const intentionalPublic = [
  "public_doctor_profile",
  "public_booking_slots",
  "create_public_booking",
  "public_booking_confirmation",
];

const accountRpcSignatures = [
  "public.cancel_own_subscription()",
  "public.current_subscription()",
  "public.ensure_doctor_subscription()",
  "public.reactivate_own_subscription()",
  "public.submit_manual_subscription_payment(numeric,text,text)",
];

const reservedSlugs = [
  "admin", "api", "app", "auth", "dashboard", "doctor", "doctors", "dr", "help",
  "login", "logout", "new", "patient", "patients", "prescription", "prescriptions",
  "profile", "root", "settings", "signup", "support", "system", "www",
];

if (guarded.length !== 61) throw new Error(`guarded fixture drift: ${guarded.length}`);
if (clinicalTables.length !== 20) throw new Error(`clinical table fixture drift: ${clinicalTables.length}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameArray(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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

    -- Supabase-compatible JWT claim source for the disposable PostgreSQL harness.
    create function auth.jwt() returns jsonb
    language sql stable
    as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    revoke all on function auth.jwt() from public;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
  `);

  const baselinePredicate = `(
    (auth.jwt() ->> 'actor_type' = 'doctor'
      and owner_doctor_id = auth.jwt() ->> 'doctor_id')
    or
    (auth.jwt() ->> 'actor_type' = 'staff'
      and practice_location_id = auth.jwt() ->> 'location_id'
      and auth.jwt() ->> 'staff_role' in ('RECEPTIONIST', 'LOCATION_ADMIN'))
  )`;

  for (const table of clinicalTables) {
    await sql.unsafe(`
      create table public.${table} (
        id integer primary key,
        owner_doctor_id text not null,
        practice_location_id text not null,
        payload text not null default ''
      );
      insert into public.${table}(id, owner_doctor_id, practice_location_id, payload) values
        (1, 'doctor-a', 'loc-a', 'a'),
        (2, 'doctor-b', 'loc-a', 'b-shared-location'),
        (3, 'doctor-b', 'loc-b', 'b-other-location');
      alter table public.${table} enable row level security;
      alter table public.${table} force row level security;
      grant select, insert, update, delete on public.${table} to authenticated;
      create policy baseline_access on public.${table}
        for all to authenticated using (${baselinePredicate}) with check (${baselinePredicate});
    `);
  }

  // The fixtures intentionally include one-line and multiline PL/pgSQL bodies,
  // SQL and PL/pgSQL, STABLE and VOLATILE, default arguments and SETOF results.
  // R1 must be independent of function-body formatting.
  for (const [index, name] of guarded.entries()) {
    if (index < 11) {
      if (name === "create_appointment") {
        await sql.unsafe(`
          create function public.${name}(p_value text default 'ok') returns text
          language sql stable security definer set search_path=public,pg_temp
          as $$ select p_value::text $$;
        `);
      } else if (name === "set_appointment_status") {
        await sql.unsafe(`
          create function public.${name}() returns setof text
          language sql stable security definer set search_path=public,pg_temp rows 7
          as $$ select 'ok'::text $$;
        `);
      } else if (name === "reschedule_appointment") {
        await sql.unsafe(`
          create function public.${name}() returns text
          language sql volatile security definer set search_path=public,pg_temp
          as $$ select 'ok'::text $$;
        `);
      } else {
        await sql.unsafe(`
          create function public.${name}() returns text
          language sql stable security definer set search_path=public,pg_temp
          as $$ select 'ok'::text $$;
        `);
      }
    } else if (name === "add_encounter_diagnosis") {
      // Exact shape that exposed the original harness/migration mismatch.
      await sql.unsafe(`
        create function public.${name}() returns text
        language plpgsql stable security definer set search_path=public,pg_temp
        as $$ begin return 'ok'; end $$;
      `);
    } else if (name === "open_encounter") {
      await sql.unsafe(`
        create function public.${name}(p_value text default 'ok') returns text
        language plpgsql stable security definer set search_path=public,pg_temp
        as $$
        declare
          v_value text := p_value;
        begin
          return v_value;
        end
        $$;
      `);
    } else if (name === "prescription_signed_medicine_history") {
      await sql.unsafe(`
        create function public.${name}() returns setof text
        language plpgsql stable security definer set search_path=public,pg_temp rows 9
        as $$
        begin
          return next 'ok';
          return;
        end
        $$;
      `);
    } else {
      await sql.unsafe(`
        create function public.${name}() returns text
        language plpgsql stable security definer set search_path=public,pg_temp
        as $$
        declare
          v text := 'ok';
        begin
          return v;
        end
        $$;
      `);
    }

    // Supabase migrations in this project explicitly close PUBLIC function
    // execution before granting roles. Model that ACL shape faithfully.
    const signature = name === "create_appointment"
      ? `public.${name}(text)`
      : name === "open_encounter"
        ? `public.${name}(text)`
        : `public.${name}()`;
    await sql.unsafe(`revoke all on function ${signature} from public; grant execute on function ${signature} to authenticated;`);
  }

  await sql.unsafe(`
    create function public.cancel_own_subscription() returns text language sql security definer as $$ select 'ok'::text $$;
    create function public.current_subscription() returns text language sql security definer as $$ select 'ok'::text $$;
    create function public.ensure_doctor_subscription() returns text language sql security definer as $$ select 'ok'::text $$;
    create function public.reactivate_own_subscription() returns text language sql security definer as $$ select 'ok'::text $$;
    create function public.submit_manual_subscription_payment(numeric,text,text) returns text language sql security definer as $$ select 'ok'::text $$;

    revoke all on function public.cancel_own_subscription() from public;
    revoke all on function public.current_subscription() from public;
    revoke all on function public.ensure_doctor_subscription() from public;
    revoke all on function public.reactivate_own_subscription() from public;
    revoke all on function public.submit_manual_subscription_payment(numeric,text,text) from public;
    grant execute on function public.cancel_own_subscription() to anon, authenticated;
    grant execute on function public.current_subscription() to anon, authenticated;
    grant execute on function public.ensure_doctor_subscription() to anon, authenticated;
    grant execute on function public.reactivate_own_subscription() to anon, authenticated;
    grant execute on function public.submit_manual_subscription_payment(numeric,text,text) to anon, authenticated;

    create function public.public_doctor_profile(text) returns text language sql security definer as $$ select 'public'::text $$;
    create function public.public_booking_slots(text,uuid,date) returns text language sql security definer as $$ select 'public'::text $$;
    create function public.create_public_booking(text,uuid,date,text,text,text,text,text) returns text language sql security definer as $$ select 'public'::text $$;
    create function public.public_booking_confirmation(text,uuid) returns text language sql security definer as $$ select 'public'::text $$;

    revoke all on function public.public_doctor_profile(text) from public;
    revoke all on function public.public_booking_slots(text,uuid,date) from public;
    revoke all on function public.create_public_booking(text,uuid,date,text,text,text,text,text) from public;
    revoke all on function public.public_booking_confirmation(text,uuid) from public;
    grant execute on function public.public_doctor_profile(text) to anon, authenticated;
    grant execute on function public.public_booking_slots(text,uuid,date) to anon, authenticated;
    grant execute on function public.create_public_booking(text,uuid,date,text,text,text,text,text) to anon, authenticated;
    grant execute on function public.public_booking_confirmation(text,uuid) to anon, authenticated;

    create function public.slug_is_reserved(candidate text)
    returns boolean language sql immutable
    as $$
      select candidate = any(array[
        'admin','api','app','auth','dashboard','doctor','doctors','dr','help',
        'login','logout','new','patient','patients','prescription','prescriptions',
        'profile','root','settings','signup','support','system','www'
      ])
    $$;
  `);
}

async function functionSnapshot() {
  const rows = await sql`
    select
      p.proname,
      p.oid::text as oid,
      l.lanname,
      pg_get_function_arguments(p.oid) as arguments,
      pg_get_function_result(p.oid) as result_type,
      p.provolatile,
      p.proisstrict,
      p.prosecdef,
      p.proleakproof,
      p.proparallel,
      p.procost::text as procost,
      p.prorows::text as prorows,
      p.proretset,
      p.proconfig,
      coalesce(p.proacl::text, '') as proacl,
      pg_get_userbyid(p.proowner) as owner
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.proname = any(${guarded})
    order by p.proname
  `;
  return new Map(rows.map((row) => [row.proname, row]));
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

const doctorAal1 = { aal: "aal1", actor_type: "doctor", doctor_id: "doctor-a" };
const doctorAal2 = { aal: "aal2", actor_type: "doctor", doctor_id: "doctor-a" };
const doctorBAal2 = { aal: "aal2", actor_type: "doctor", doctor_id: "doctor-b" };
const staffAal1 = { aal: "aal1", actor_type: "staff", staff_role: "RECEPTIONIST", location_id: "loc-a" };
const staffAal2 = { aal: "aal2", actor_type: "staff", staff_role: "RECEPTIONIST", location_id: "loc-a" };
const staffOtherAal2 = { aal: "aal2", actor_type: "staff", staff_role: "LOCATION_ADMIN", location_id: "loc-b" };

try {
  await setup();
  const before = await functionSnapshot();
  assert(before.size === 61, `expected 61 pre-migration RPC snapshots, found ${before.size}`);

  const slugBefore = await sql`
    select public.slug_is_reserved('admin') as admin,
           public.slug_is_reserved('ordinary-doctor-slug') as ordinary
  `;

  await sql.unsafe(migration);
  // Forward SQL must be safe to replay in disposable verification.
  await sql.unsafe(migration);

  const policyCount = await sql`
    select count(*)::int as n from pg_policies
    where schemaname='public' and policyname='sec01b_aal2_required'
      and permissive='RESTRICTIVE'
  `;
  assert(policyCount[0].n === 20, `expected 20 restrictive policies, found ${policyCount[0].n}`);

  const after = await functionSnapshot();
  assert(after.size === 61, `expected 61 post-migration RPC snapshots, found ${after.size}`);
  for (const name of guarded) {
    const a = before.get(name);
    const b = after.get(name);
    assert(a && b, `missing function snapshot for ${name}`);
    for (const key of [
      "oid", "lanname", "arguments", "result_type", "provolatile", "proisstrict",
      "prosecdef", "proleakproof", "proparallel", "procost", "prorows",
      "proretset", "proacl", "owner",
    ]) {
      assert(a[key] === b[key], `${name} changed ${key}: ${a[key]} -> ${b[key]}`);
    }
    assert(sameArray(a.proconfig, b.proconfig), `${name} changed function SET configuration`);
  }
  console.log("SEC01B_FUNCTION_METADATA_PRESERVED=61");

  const guardedCount = await sql`
    select count(*)::int as n
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
      and p.proname = any(${guarded})
      and (
        position('public.require_aal2()' in p.prosrc) > 0
        or position('public.session_is_aal2()' in p.prosrc) > 0
      )
  `;
  assert(guardedCount[0].n === 61, `expected 61 guarded RPCs, found ${guardedCount[0].n}`);

  // AAL helper itself is JWT-derived and fail-closed.
  const helperAal1 = await asRole("authenticated", doctorAal1, (tx) => tx`select public.session_is_aal2() as v`);
  const helperAal2 = await asRole("authenticated", doctorAal2, (tx) => tx`select public.session_is_aal2() as v`);
  assert(helperAal1[0].v === false && helperAal2[0].v === true, "AAL helper did not follow JWT claims");

  // Direct RLS: AAL1 has no clinical authority; AAL2 still obeys existing owner/location rules.
  const aal1DoctorRows = await asRole("authenticated", doctorAal1, (tx) => tx`select id from public.patients order by id`);
  assert(aal1DoctorRows.length === 0, "AAL1 Doctor direct clinical SELECT returned rows");
  const aal2DoctorRows = await asRole("authenticated", doctorAal2, (tx) => tx`select id from public.patients order by id`);
  assert(JSON.stringify(aal2DoctorRows.map((r) => r.id)) === JSON.stringify([1]), "AAL2 Doctor ownership isolation changed");
  const crossDoctorRows = await asRole("authenticated", doctorAal2, (tx) => tx`select id from public.patients where id=2`);
  assert(crossDoctorRows.length === 0, "AAL2 Doctor crossed Doctor ownership boundary");
  const doctorBRows = await asRole("authenticated", doctorBAal2, (tx) => tx`select id from public.patients order by id`);
  assert(JSON.stringify(doctorBRows.map((r) => r.id)) === JSON.stringify([2, 3]), "Doctor B baseline ownership was not preserved");

  const aal1StaffRows = await asRole("authenticated", staffAal1, (tx) => tx`select id from public.patients order by id`);
  assert(aal1StaffRows.length === 0, "AAL1 staff direct clinical SELECT returned rows");
  const aal2StaffRows = await asRole("authenticated", staffAal2, (tx) => tx`select id from public.patients order by id`);
  assert(JSON.stringify(aal2StaffRows.map((r) => r.id)) === JSON.stringify([1, 2]), "AAL2 staff location scope changed");
  const otherStaffRows = await asRole("authenticated", staffOtherAal2, (tx) => tx`select id from public.patients order by id`);
  assert(JSON.stringify(otherStaffRows.map((r) => r.id)) === JSON.stringify([3]), "AAL2 staff crossed location boundary");

  await expectRejected(
    () => asRole("authenticated", doctorAal1, (tx) => tx`
      insert into public.patients(id,owner_doctor_id,practice_location_id,payload)
      values (4,'doctor-a','loc-a','new')
    `),
    /row-level security/i,
  );
  await asRole("authenticated", doctorAal2, (tx) => tx`
    insert into public.patients(id,owner_doctor_id,practice_location_id,payload)
    values (4,'doctor-a','loc-a','new')
  `);
  const aal1Update = await asRole("authenticated", doctorAal1, (tx) => tx`update public.patients set payload='blocked' where id=1 returning id`);
  assert(aal1Update.length === 0, "AAL1 Doctor UPDATE had authority");
  const aal2Update = await asRole("authenticated", doctorAal2, (tx) => tx`update public.patients set payload='allowed' where id=1 returning id`);
  assert(aal2Update.length === 1, "AAL2 Doctor authorized UPDATE was lost");
  const aal1Delete = await asRole("authenticated", doctorAal1, (tx) => tx`delete from public.patients where id=1 returning id`);
  assert(aal1Delete.length === 0, "AAL1 Doctor DELETE had authority");
  const crossUpdate = await asRole("authenticated", doctorAal2, (tx) => tx`update public.patients set payload='cross' where id=2 returning id`);
  assert(crossUpdate.length === 0, "AAL2 Doctor UPDATE crossed ownership boundary");
  console.log("SEC01B_DIRECT_RLS_MATRIX=PASS");

  // Every externally callable guarded fixture must reject AAL1 and work at AAL2.
  for (const name of guarded) {
    await expectRejected(
      () => asRole("authenticated", doctorAal1, (tx) => tx.unsafe(`select * from public.${name}()`)),
      /AAL2_REQUIRED/,
    );
    const rows = await asRole("authenticated", doctorAal2, (tx) => tx.unsafe(`select * from public.${name}()`));
    assert(rows.length >= 1, `AAL2 guarded RPC failed: ${name}`);
  }
  console.log("SEC01B_SECURITY_DEFINER_MATRIX=61_PASS");

  for (const name of [
    "owner_pending_claims",
    "owner_pending_payments",
    "owner_decide_doctor_profile_claim",
    "owner_decide_subscription_payment",
  ]) {
    await expectRejected(
      () => asRole("authenticated", { aal: "aal1", actor_type: "owner" }, (tx) => tx.unsafe(`select * from public.${name}()`)),
      /AAL2_REQUIRED/,
    );
    const rows = await asRole("authenticated", { aal: "aal2", actor_type: "owner" }, (tx) => tx.unsafe(`select * from public.${name}()`));
    assert(rows.length >= 1, `AAL2 owner RPC failed: ${name}`);
  }
  console.log("SEC01B_OWNER_MATRIX=PASS");

  const publicCalls = [
    ["public_doctor_profile", "select public.public_doctor_profile('doctor') as v"],
    ["public_booking_slots", "select public.public_booking_slots('doctor','00000000-0000-0000-0000-000000000001'::uuid,current_date) as v"],
    ["create_public_booking", "select public.create_public_booking('doctor','00000000-0000-0000-0000-000000000001'::uuid,current_date,'10:00','Patient','01700000000','M','Visit') as v"],
    ["public_booking_confirmation", "select public.public_booking_confirmation('doctor','00000000-0000-0000-0000-000000000001'::uuid) as v"],
  ];
  for (const [name, statement] of publicCalls) {
    const rows = await asRole("anon", {}, (tx) => tx.unsafe(statement));
    assert(rows[0]?.v === "public", `intentional anon public RPC broke: ${name}`);
  }

  for (const signature of accountRpcSignatures) {
    await expectRejected(
      () => asRole("anon", {}, (tx) => tx.unsafe(`select ${signature.replace(/^public\./, "public.").replace(/\(numeric,text,text\)$/, "(1,'x','y')")} as v`)),
      /permission denied/i,
    );
  }
  const subscriptionOk = await asRole("authenticated", doctorAal1, (tx) => tx`select public.cancel_own_subscription() as v`);
  assert(subscriptionOk[0].v === "ok", "authenticated non-clinical subscription action was over-gated");

  const acl = await sql`
    select
      has_function_privilege('anon','public.cancel_own_subscription()','EXECUTE') as anon_cancel,
      has_function_privilege('anon','public.current_subscription()','EXECUTE') as anon_current,
      has_function_privilege('anon','public.ensure_doctor_subscription()','EXECUTE') as anon_ensure,
      has_function_privilege('anon','public.reactivate_own_subscription()','EXECUTE') as anon_reactivate,
      has_function_privilege('anon','public.submit_manual_subscription_payment(numeric,text,text)','EXECUTE') as anon_submit,
      has_function_privilege('authenticated','public.cancel_own_subscription()','EXECUTE') as auth_cancel,
      has_function_privilege('anon','public.public_doctor_profile(text)','EXECUTE') as anon_public
  `;
  assert(
    [acl[0].anon_cancel, acl[0].anon_current, acl[0].anon_ensure, acl[0].anon_reactivate, acl[0].anon_submit].every((v) => v === false),
    "one or more of the five anon account grants remains",
  );
  assert(acl[0].auth_cancel === true, "authenticated account EXECUTE was lost");
  assert(acl[0].anon_public === true, "intentional public EXECUTE was lost");
  console.log("SEC01B_ANON_PUBLIC_MATRIX=PASS");

  const slug = await sql`
    select public.slug_is_reserved('admin') as admin,
           public.slug_is_reserved('ordinary-doctor-slug') as ordinary,
           (select proconfig from pg_proc where oid='public.slug_is_reserved(text)'::regprocedure) as config
  `;
  assert(slug[0].admin === slugBefore[0].admin && slug[0].ordinary === slugBefore[0].ordinary, "slug behavior changed");
  for (const slugName of reservedSlugs) {
    const result = await sql`select public.slug_is_reserved(${slugName}) as reserved`;
    assert(result[0].reserved === true, `reserved slug was lost: ${slugName}`);
  }
  assert((slug[0].config ?? []).some((v) => /search_path=pg_catalog, public/.test(v)), "slug search_path not fixed");

  const publicGuardLeak = await sql`
    select count(*)::int as n
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname = any(${intentionalPublic})
      and (
        position('public.require_aal2()' in p.prosrc) > 0
        or position('public.session_is_aal2()' in p.prosrc) > 0
      )
  `;
  assert(publicGuardLeak[0].n === 0, "public booking/profile function was AAL2-guarded");
  console.log("SEC01B_SLUG_AND_PUBLIC_PRESERVATION=PASS");

  console.log("SEC01B_SQL_MECHANICS=PASS");
} finally {
  await sql.end();
}
