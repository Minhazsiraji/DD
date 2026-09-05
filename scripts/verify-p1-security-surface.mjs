import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();
const TABLES = [
  "platform_staff", "platform_staff_roles", "credential_review_events",
  "medical_institutions", "medical_student_profiles", "student_enrollments",
  "health_signal_registry", "health_signal_registry_keys", "system_health_signals",
];
const P1_FUNCTIONS = [
  "p1_jsonb_object_key_count", "has_platform_staff_role", "prevent_append_only_p1_change",
  "enforce_platform_staff_role_separation", "grant_platform_staff_role",
  "revoke_platform_staff_role", "refresh_profile_capabilities",
  "refresh_student_capability_trigger", "refresh_student_profile_capability_trigger",
  "submit_credential", "respond_to_credential", "decide_credential",
  "list_pending_credential_reviews", "read_credential_review_case",
  "read_credential_review_history", "activate_platform_staff",
  "deactivate_platform_staff", "bootstrap_platform_admin",
  "submit_student_enrollment", "decide_enrollment", "validate_system_health_detail",
  "require_platform_analyst", "owner_metrics_overview", "owner_metrics_timeseries",
  "owner_metrics_new_doctors", "owner_system_health", "owner_system_health_history",
];
const APPLICATION_ROLES = [
  "anon", "authenticated", "service_role", "dd_owner_analytics",
  "dd_metrics_reader", "dd_metrics_rollup", "dd_public_ingress",
];
const P1_SEQUENCES = ["credential_review_events_seq_seq"];
const AUTH_FORBIDDEN = new Set([
  "p1_jsonb_object_key_count", "prevent_append_only_p1_change",
  "enforce_platform_staff_role_separation", "refresh_profile_capabilities",
  "refresh_student_capability_trigger", "refresh_student_profile_capability_trigger",
  "validate_system_health_detail", "require_platform_analyst",
  "bootstrap_platform_admin",
]);

try {
  const rls = await sql`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any(${TABLES})
    order by c.relname
  `;
  assert(rls.length === TABLES.length, `P1 table inventory mismatch: ${rls.length}/${TABLES.length}`);
  for (const row of rls) {
    assert(row.relrowsecurity === true && row.relforcerowsecurity === true,
      `${row.relname} is not RLS + FORCE RLS`);
  }

  for (const table of TABLES) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const [row] = await sql.unsafe(
        `select has_table_privilege('service_role', 'public.${table}', '${privilege}') as allowed`,
      );
      assert(row.allowed === false, `service_role unexpectedly has ${privilege} on ${table}`);
    }
  }

  for (const sequence of P1_SEQUENCES) {
    for (const role of APPLICATION_ROLES) {
      for (const privilege of ["USAGE", "SELECT", "UPDATE"]) {
        const [row] = await sql.unsafe(
          `select has_sequence_privilege('${role}', 'public.${sequence}', '${privilege}') as allowed`,
        );
        assert(row.allowed === false, `${role} unexpectedly has ${privilege} on ${sequence}`);
      }
    }
  }

  const functions = await sql`
    select p.oid, p.proname,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(${P1_FUNCTIONS})
    order by p.proname, p.oid
  `;
  const observed = new Set(functions.map((row) => row.proname));
  for (const name of P1_FUNCTIONS) assert(observed.has(name), `P1 function missing: ${name}`);
  for (const row of functions) {
    assert(row.service_exec === false, `service_role unexpectedly executes ${row.proname}`);
    if (AUTH_FORBIDDEN.has(row.proname)) {
      assert(row.auth_exec === false, `authenticated unexpectedly executes internal ${row.proname}`);
    }
  }

  const expectedAuthenticated = [
    "has_platform_staff_role", "grant_platform_staff_role", "revoke_platform_staff_role",
    "submit_credential", "respond_to_credential", "decide_credential",
    "list_pending_credential_reviews", "read_credential_review_case",
    "read_credential_review_history", "activate_platform_staff",
    "deactivate_platform_staff",
    "submit_student_enrollment", "decide_enrollment", "owner_metrics_overview",
    "owner_metrics_timeseries", "owner_metrics_new_doctors", "owner_system_health",
    "owner_system_health_history",
  ];
  for (const name of expectedAuthenticated) {
    const rows = functions.filter((row) => row.proname === name);
    assert(rows.length > 0 && rows.every((row) => row.auth_exec === true),
      `authenticated caller surface missing ${name}`);
  }

  const definerRows = await sql`
    select p.proname, p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(${P1_FUNCTIONS}) and p.prosecdef
    order by p.proname
  `;
  assert(definerRows.length > 0, "P1 SECURITY DEFINER inventory unexpectedly empty");
  for (const row of definerRows) {
    const config = row.proconfig ?? [];
    assert(config.some((value) => value.replaceAll(' ', '') === 'search_path=public,pg_temp'),
      `${row.proname} SECURITY DEFINER lacks pinned public,pg_temp search_path`);
  }
  for (const role of APPLICATION_ROLES) {
    const [row] = await sql.unsafe(
      `select has_schema_privilege('${role}', 'public', 'CREATE') as allowed`,
    );
    assert(row.allowed === false, `${role} unexpectedly has CREATE on public schema`);
  }

  const [eventsRead] = await sql`
    select has_table_privilege('authenticated', 'public.credential_review_events', 'SELECT') as allowed
  `;
  assert(eventsRead.allowed === false,
    "credential_review_events unexpectedly exposes direct authenticated discovery/read");

  const [bootstrap] = await sql`
    select p.prosecdef,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='bootstrap_platform_admin'
  `;
  assert(bootstrap && bootstrap.prosecdef === false,
    "bootstrap_platform_admin must remain SECURITY INVOKER");
  assert(!bootstrap.anon_exec && !bootstrap.auth_exec && !bootstrap.service_exec,
    "bootstrap_platform_admin leaked to an application role");

  const verifierPolicies = await sql`
    select tablename, policyname, roles, qual, with_check
    from pg_policies
    where schemaname='public'
      and tablename in ('profiles','professional_profiles','professional_credentials','credential_review_events')
      and (coalesce(qual,'') || coalesce(with_check,'') || array_to_string(roles,','))
          ilike '%CREDENTIAL_VERIFIER%'
  `;
  assert(verifierPolicies.length === 0,
    `credential verifier gained direct-table policy access: ${JSON.stringify(verifierPolicies)}`);

  console.log(`verify-p1-security-surface: PASS (${TABLES.length} FORCE-RLS tables; service_role no P1 table/function shortcut; P1 sequence closed; definer search_path trusted; internal functions hidden)`);
} finally {
  await sql.end({ timeout: 5 });
}
