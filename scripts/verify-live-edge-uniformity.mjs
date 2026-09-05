import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();

function normalized(text) {
  return String(text ?? "").replace(/\s+/g, " ").toLowerCase();
}

try {
  const [liveFn] = await sql`
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='is_live_edge'
  `;
  const liveDef = normalized(liveFn?.definition);
  for (const term of [
    "effective_from <= clock_timestamp()",
    "expires_at is null or expires_at > clock_timestamp()",
    "revoked_at is null",
  ]) {
    assert(liveDef.includes(term), `is_live_edge missing canonical term: ${term}`);
  }

  const [runtime] = await sql`
    select
      public.is_live_edge(now()-interval '1 hour', now()+interval '1 hour', null) as live,
      public.is_live_edge(now()+interval '1 hour', now()+interval '2 hour', null) as future,
      public.is_live_edge(now()-interval '2 hour', now()-interval '1 hour', null) as expired,
      public.is_live_edge(now()-interval '2 hour', now()+interval '1 hour', now()) as revoked
  `;
  assert(runtime.live === true && runtime.future === false && runtime.expired === false && runtime.revoked === false,
    `is_live_edge runtime truth table failed: ${JSON.stringify(runtime)}`);

  const policies = await sql`
    select policyname, tablename, coalesce(qual,'') || ' ' || coalesce(with_check,'') as definition
    from pg_policies where schemaname='public'
  `;
  const expectedPolicies = [
    "health_subject_access_self_read",
    "health_subjects_access_read",
    "consent_subject_read",
  ];
  for (const name of expectedPolicies) {
    const row = policies.find((p) => p.policyname === name);
    assert(row, `missing live-edge policy ${name}`);
    assert(normalized(row.definition).includes("is_live_edge("), `${name} does not use canonical is_live_edge()`);
  }
  const consentPolicy = policies.find((p) => p.policyname === "consent_subject_read");
  const consentDef = normalized(consentPolicy.definition);
  assert(
    /is_live_edge\((?:consent_records\.)?effective_from, (?:consent_records\.)?expires_at, (?:consent_records\.)?revoked_at\)/.test(consentDef),
    "consent read does not evaluate consent row's complete live edge",
  );

  const credentialFns = await sql`
    select p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prokind='f'
      and pg_get_functiondef(p.oid) ilike '%from public.professional_credentials%'
  `;
  const authorityFns = credentialFns.filter((row) =>
    ["refresh_profile_capabilities", "public_chamber_is_eligible"].includes(row.proname),
  );
  assert(authorityFns.length === 2, `credential authority function inventory drifted: ${JSON.stringify(credentialFns.map(r => r.proname))}`);
  for (const row of authorityFns) {
    const def = normalized(row.definition);
    for (const term of [
      "verification_status = 'verified'",
      "verified_at is not null",
      "verified_at <= clock_timestamp()",
      "expires_at is null",
      "expires_at > clock_timestamp()",
    ]) {
      assert(def.includes(term), `${row.proname} missing credential live term: ${term}`);
    }
  }

  const [hasCapability] = await sql`
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='has_capability'
  `;
  const capDef = normalized(hasCapability.definition);
  assert(capDef.includes("effective_from <= clock_timestamp()"), "has_capability ignores effective_from");
  assert(capDef.includes("effective_until is null or pc.effective_until > clock_timestamp()"), "has_capability ignores expiry");

  console.log(`verify-live-edge-uniformity: PASS (${expectedPolicies.length} edge policies + ${authorityFns.length} credential authority paths + capability read-time validity)`);
} finally {
  await sql.end({ timeout: 5 });
}
