-- =============================================================================
-- TRUNCATE, revoked everywhere.
--
-- Found while auditing the prescription grants, and it was never about
-- prescriptions: Supabase's default privileges grant `authenticated` every verb
-- on every new table, and TRUNCATE was among them on all twenty-five clinical
-- tables — patients, encounters, appointments, audit_events included.
--
-- TRUNCATE DOES NOT GO THROUGH ROW LEVEL SECURITY. Every policy in this
-- directory filters rows for SELECT/INSERT/UPDATE/DELETE; none of them is
-- consulted for a TRUNCATE. So a signed-in user with nothing but an ordinary
-- session could have emptied the entire record — and `truncate ... cascade`
-- would have taken the audit trail with it, leaving nothing to say who did it.
--
-- It was reachable: proved by running `truncate table public.prescriptions
-- cascade` as `authenticated`, which succeeded.
--
-- Applied to EVERY table in `public`, not a list, because the next table added
-- would otherwise arrive with the same hole. Re-runs harmlessly.
-- =============================================================================

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke truncate on public.%I from authenticated, anon', t.relname);
  end loop;
end;
$$;
