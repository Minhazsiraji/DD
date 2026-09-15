-- =============================================================================
-- 0051 — Medicines V1 reconciliation
--
-- CENTRAL-assigned canonical repository representation of the Medicine V1
-- authority that already exists in the protected pilot database.
--
-- IMPORTANT PILOT LEDGER RULE
-- ---------------------------
-- The protected database already contains these tables, policies and functions,
-- but its Supabase migration ledger does not contain a Medicine migration. This
-- file MUST NOT be replayed or marked applied on that protected database during
-- M4. It exists so a clean/future database can reproduce the accepted authority.
--
-- Historical authority was split across Drizzle 0022_medicines_v1.sql and
-- supabase/policies/0043_medicines_v1.sql. Frozen M3 independently owns 0043,
-- therefore Medicine is reconciled here under CENTRAL-assigned 0051.
--
-- NON-DESTRUCTIVE RECONCILIATION
-- ------------------------------
-- Tables/types are created only when absent. Existing populated tables are not
-- dropped, truncated or recreated. Policies and functions are named authority
-- objects and are replaced idempotently. Indexes are CREATE IF NOT EXISTS.
-- =============================================================================

-- The accepted live enum contains exactly these three labels in this order.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'medicine_source_kind'
  ) then
    create type public.medicine_source_kind as enum (
      'MANUAL_SEED', 'DOCTOR_CONTRIBUTED', 'LICENSED_IMPORT'
    );
  end if;
end
$$;

-- Shared reference catalogue. Identity/provenance only; no clinical advice.
create table if not exists public.medicine_references (
  id uuid primary key default gen_random_uuid(),
  generic_name text not null,
  brand_name text,
  strength_text text,
  dosage_form text,
  manufacturer text,
  country_code text not null,
  regulator_name text,
  source_kind public.medicine_source_kind not null default 'MANUAL_SEED',
  source_note text,
  last_verified_at timestamptz,
  is_active boolean not null default true,
  generic_normalized text generated always as (
    lower(btrim(regexp_replace(generic_name, '\s+', ' ', 'g')))
  ) stored,
  brand_normalized text generated always as (
    lower(btrim(regexp_replace(coalesce(brand_name, ''), '\s+', ' ', 'g')))
  ) stored,
  search_text text generated always as (
    lower(btrim(regexp_replace(
      generic_name || ' ' || coalesce(brand_name, '') || ' ' ||
      coalesce(strength_text, '') || ' ' || coalesce(dosage_form, ''),
      '\s+', ' ', 'g'
    )))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medicine_references_generic_not_blank check (btrim(generic_name) <> ''),
  constraint medicine_references_country_code check (country_code ~ '^[A-Z]{2}$'),
  constraint medicine_references_lengths check (
    length(generic_name) <= 200
    and (brand_name is null or length(brand_name) <= 200)
    and (strength_text is null or length(strength_text) <= 100)
    and (dosage_form is null or length(dosage_form) <= 100)
    and (manufacturer is null or length(manufacturer) <= 200)
    and (regulator_name is null or length(regulator_name) <= 100)
    and (source_note is null or length(source_note) <= 500)
  )
);

-- One doctor's private recall/default library.
create table if not exists public.doctor_medicines (
  id uuid primary key default gen_random_uuid(),
  doctor_profile_id uuid not null references public.doctor_profiles(id) on delete cascade,
  medicine_reference_id uuid references public.medicine_references(id) on delete set null,
  display_name text not null,
  generic_name text,
  brand_name text,
  strength_text text,
  dosage_form text,
  route text,
  default_dose_text text,
  default_schedule_text text,
  default_duration_text text,
  default_quantity_text text,
  default_food_relation text,
  default_instructions text,
  default_is_prn boolean not null default false,
  is_favorite boolean not null default false,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  is_active boolean not null default true,
  display_normalized text generated always as (
    lower(btrim(regexp_replace(display_name, '\s+', ' ', 'g')))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctor_medicines_display_not_blank check (btrim(display_name) <> ''),
  constraint doctor_medicines_lengths check (
    length(display_name) <= 200
    and (generic_name is null or length(generic_name) <= 200)
    and (brand_name is null or length(brand_name) <= 200)
    and (strength_text is null or length(strength_text) <= 100)
    and (dosage_form is null or length(dosage_form) <= 100)
    and (route is null or length(route) <= 100)
    and (default_dose_text is null or length(default_dose_text) <= 100)
    and (default_schedule_text is null or length(default_schedule_text) <= 100)
    and (default_duration_text is null or length(default_duration_text) <= 100)
    and (default_quantity_text is null or length(default_quantity_text) <= 100)
    and (default_food_relation is null or length(default_food_relation) <= 100)
    and (default_instructions is null or length(default_instructions) <= 1000)
  ),
  constraint doctor_medicines_usage_count check (usage_count >= 0)
);

create unique index if not exists medicine_references_identity
  on public.medicine_references (
    country_code, generic_normalized, brand_normalized, strength_text, dosage_form
  );
create index if not exists medicine_references_generic_idx
  on public.medicine_references (generic_normalized);
create index if not exists medicine_references_brand_idx
  on public.medicine_references (brand_normalized);
create index if not exists medicine_references_country_idx
  on public.medicine_references (country_code, is_active);

create unique index if not exists doctor_medicines_unique
  on public.doctor_medicines (doctor_profile_id, display_normalized, strength_text);
create index if not exists doctor_medicines_library_idx
  on public.doctor_medicines (doctor_profile_id, is_active, is_favorite);
create index if not exists doctor_medicines_recent_idx
  on public.doctor_medicines (doctor_profile_id, last_used_at);

alter table public.medicine_references enable row level security;
alter table public.doctor_medicines enable row level security;
alter table public.medicine_references force row level security;
alter table public.doctor_medicines force row level security;

-- Shared reference catalogue: authenticated active read only.
drop policy if exists medicine_references_select on public.medicine_references;
create policy medicine_references_select
  on public.medicine_references for select to authenticated
  using (is_active);

revoke all on table public.medicine_references from anon;
revoke insert, update, delete, truncate on table public.medicine_references from authenticated;
grant select on table public.medicine_references to authenticated;

-- Private doctor library: only current_doctor_id() in every write/read direction.
drop policy if exists doctor_medicines_select on public.doctor_medicines;
create policy doctor_medicines_select
  on public.doctor_medicines for select to authenticated
  using (doctor_profile_id = public.current_doctor_id());

drop policy if exists doctor_medicines_insert on public.doctor_medicines;
create policy doctor_medicines_insert
  on public.doctor_medicines for insert to authenticated
  with check (doctor_profile_id = public.current_doctor_id());

drop policy if exists doctor_medicines_update on public.doctor_medicines;
create policy doctor_medicines_update
  on public.doctor_medicines for update to authenticated
  using (doctor_profile_id = public.current_doctor_id())
  with check (doctor_profile_id = public.current_doctor_id());

-- No DELETE policy. Removal is archival (is_active=false).
revoke all on table public.doctor_medicines from anon;
revoke delete, truncate on table public.doctor_medicines from authenticated;
grant select, insert, update on table public.doctor_medicines to authenticated;

-- Query normalisation must remain identical to the generated search keys.
create or replace function public.normalize_medicine_text(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')));
$$;

create or replace function public.medicine_like_pattern(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- Literal token-by-token catalogue search. Never fuzzy/substituting.
create or replace function public.search_medicines(
  p_query text,
  p_country text default null,
  p_limit int default 25
)
returns table (
  id uuid,
  generic_name text,
  brand_name text,
  strength_text text,
  dosage_form text,
  manufacturer text,
  country_code text,
  regulator_name text,
  source_kind public.medicine_source_kind,
  last_verified_at timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  with q as (
    select
      public.normalize_medicine_text(p_query) as needle,
      nullif(upper(btrim(coalesce(p_country, ''))), '') as country,
      least(greatest(coalesce(p_limit, 25), 1), 100) as lim
  )
  select
    m.id, m.generic_name, m.brand_name, m.strength_text, m.dosage_form,
    m.manufacturer, m.country_code, m.regulator_name, m.source_kind,
    m.last_verified_at
  from public.medicine_references m, q
  where
    length(q.needle) >= 2
    and (q.country is null or m.country_code = q.country)
    and (
      select bool_and(
        m.search_text like '%' || public.medicine_like_pattern(tok) || '%'
      )
      from unnest(string_to_array(q.needle, ' ')) as tok
      where tok <> ''
    )
  order by
    case
      when m.generic_normalized like public.medicine_like_pattern(q.needle) || '%' then 0
      when m.brand_normalized like public.medicine_like_pattern(q.needle) || '%' then 1
      when m.generic_normalized like '%' || public.medicine_like_pattern(q.needle) || '%' then 2
      else 3
    end,
    m.generic_name,
    m.brand_name nulls first,
    m.strength_text nulls first,
    m.id
  limit (select lim from q);
$$;

revoke all on function public.normalize_medicine_text(text) from public, anon;
revoke all on function public.medicine_like_pattern(text) from public, anon;
revoke all on function public.search_medicines(text, text, int) from public, anon;
grant execute on function public.normalize_medicine_text(text) to authenticated;
grant execute on function public.medicine_like_pattern(text) to authenticated;
grant execute on function public.search_medicines(text, text, int) to authenticated;

comment on function public.search_medicines(text, text, int) is
  'Literal (prefix/substring) catalogue search. Never fuzzy: a search must not '
  'offer a different molecule than the one typed. Reference data only — this '
  'function has no authority over prescriptions and returns no clinical advice.';

-- Usage bookkeeping. SECURITY DEFINER is required to update behind forced RLS,
-- so ownership is re-checked inside and EXECUTE is explicitly closed to PUBLIC/anon.
create or replace function public.touch_doctor_medicine(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
begin
  if v_doctor is null then
    raise exception 'Only a doctor may record medicine usage'
      using errcode = '42501';
  end if;

  update public.doctor_medicines
     set usage_count = usage_count + 1,
         last_used_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_id
     and doctor_profile_id = v_doctor;
end;
$$;

revoke all on function public.touch_doctor_medicine(uuid) from public, anon;
grant execute on function public.touch_doctor_medicine(uuid) to authenticated;

comment on function public.touch_doctor_medicine(uuid) is
  'Increments usage bookkeeping on the CALLER''S OWN saved medicine. Re-checks '
  'ownership internally (definer functions do not inherit RLS). Writes no '
  'clinical data and confers no prescribing authority.';
