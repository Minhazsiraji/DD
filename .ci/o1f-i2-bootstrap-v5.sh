#!/usr/bin/env bash
set -euo pipefail
cp .ci/o1f-i2-bootstrap.sh /tmp/o1f-i2-bootstrap-v5-run.sh
python3 - <<'PY'
from pathlib import Path
p = Path('/tmp/o1f-i2-bootstrap-v5-run.sh')
s = p.read_text()

candidate_anchor = '''cp /tmp/verify-o1f-i2-contract.mjs scripts/verify-o1f-i2-contract.mjs
node --check scripts/verify-o1f-i1-contract.mjs
'''
candidate_replacement = '''cp /tmp/verify-o1f-i2-contract.mjs scripts/verify-o1f-i2-contract.mjs
python3 "$OLDPWD/.ci/o1f-i2-postprocess.py"
node --check scripts/verify-o1f-i1-contract.mjs
'''
if s.count(candidate_anchor) != 1:
    raise SystemExit(f'candidate postprocess injection mismatch: {s.count(candidate_anchor)}')
s = s.replace(candidate_anchor, candidate_replacement, 1)

runtime_anchor = '''  docker exec "$name" pg_isready -U postgres -d o1f >/dev/null
  DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${port}/o1f" node "$verifier"
'''
runtime_replacement = '''  docker exec "$name" pg_isready -U postgres -d o1f >/dev/null
  docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U postgres -d o1f >/dev/null <<'PGSQL'
create extension if not exists pgcrypto;
do $bootstrap$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role noinherit bypassrls;
  end if;
end
$bootstrap$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $uid$
  select nullif(
    coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub',
    ''
  )::uuid;
$uid$;
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $jwt$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$jwt$;
grant usage on schema auth to public;
grant execute on function auth.uid() to public;
grant execute on function auth.jwt() to public;
PGSQL
  DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${port}/o1f" node "$verifier"
'''
if s.count(runtime_anchor) != 1:
    raise SystemExit(f'disposable runtime injection mismatch: {s.count(runtime_anchor)}')
s = s.replace(runtime_anchor, runtime_replacement, 1)

p.write_text(s)
PY
bash /tmp/o1f-i2-bootstrap-v5-run.sh
