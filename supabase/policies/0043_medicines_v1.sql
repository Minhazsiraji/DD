-- =============================================================================
-- 0043 — Medicines V1: a shared reference catalogue and a private doctor library.
--
-- TWO LAYERS, TWO COMPLETELY DIFFERENT AUTHORITY MODELS.
--
--   medicine_references   Shared identity data. Readable by every signed-in
--                         user, writable by NOBODY through the API. The
--                         catalogue is curated out-of-band (seed script under
--                         the service role), because one doctor editing what
--                         every other doctor sees is not a feature we want and
--                         is trivially the wrong default to start from.
--
--   doctor_medicines      One doctor's saved defaults. Readable and writable by
--                         that doctor and by no one else — not another doctor,
--                         not reception, not a location admin, not the platform
--                         owner, not anon.
--
-- NOTHING HERE IS CLINICAL AUTHORITY. No function in this file writes to
-- prescriptions, encounters or patients; none is granted any privilege on those
-- tables; and no finalisation path is touched. A saved default is a doctor's
-- own note to themselves about their own habit.
--
-- SEARCH IS LITERAL. `search_medicines` matches with prefix and substring on a
-- derived, normalised key. There is deliberately no trigram, no `similarity()`,
-- no soundex, no levenshtein and no "did you mean" — a search that silently
-- offers a different molecule than the one typed is a prescribing hazard, not a
-- convenience. Typo tolerance can be added later ONLY as a clearly-labelled,
-- separately-ranked suggestion the doctor must choose.
-- =============================================================================

alter table public.medicine_references enable row level security;
alter table public.doctor_medicines    enable row level security;

-- The owner is not exempt either. A definer function that touches these tables
-- must restate the rule rather than inherit an exemption.
alter table public.medicine_references force row level security;
alter table public.doctor_medicines    force row level security;

-- -----------------------------------------------------------------------------
-- Reference catalogue — read-only to the entire application.
-- -----------------------------------------------------------------------------

/**
 * Every signed-in user may read the ACTIVE catalogue.
 *
 * This is identity data about medicines on a market — what is printed on the
 * box. It names no patient and belongs to no doctor, so there is no tenant to
 * scope it to. Inactive rows are withheld from the API so a withdrawn entry
 * stops being offered; they remain in the table because a finalised
 * prescription may name one and history must stay readable.
 */
drop policy if exists medicine_references_select on public.medicine_references;
create policy medicine_references_select
  on public.medicine_references for select to authenticated
  using (is_active);

/**
 * Supabase grants `authenticated` every verb on a new table by default, and
 * omitting a verb from a GRANT does not remove it. So revoke explicitly.
 *
 * There is no INSERT/UPDATE/DELETE policy above and no write grant here: the
 * catalogue cannot be written through PostgREST at all. Seeding runs under the
 * service role in `scripts/seed-medicines.mjs`, which is a deliberate,
 * reviewable, out-of-band act rather than something a signed-in user can do.
 */
revoke all on table public.medicine_references from anon;
revoke insert, update, delete, truncate on table public.medicine_references from authenticated;
grant select on table public.medicine_references to authenticated;

-- -----------------------------------------------------------------------------
-- Doctor's personal library — private to one doctor, in every direction.
-- -----------------------------------------------------------------------------

/**
 * The doctor reads their own rows and nothing else.
 *
 * `current_doctor_id()` resolves the caller's OWN doctor profile from
 * `auth.uid()`. It is the existing clinical-authority/doctor-profile gate; it
 * does not prove BMDC verification or any credential check, and nothing here
 * depends on it doing so. A caller with no doctor profile — reception, a
 * location admin, the platform owner, anyone else — gets NULL from it, and
 * `doctor_profile_id = null` is never true, so they match no row. That is the
 * whole reception/owner/other-doctor exclusion: not a denial rule that could be
 * forgotten, but the absence of any rule that would admit them.
 *
 * Archived rows are still readable by their owner: a doctor must be able to see
 * and restore what they archived. Filtering by `is_active` is the LIST's job,
 * not the policy's.
 */
drop policy if exists doctor_medicines_select on public.doctor_medicines;
create policy doctor_medicines_select
  on public.doctor_medicines for select to authenticated
  using (doctor_profile_id = public.current_doctor_id());

/**
 * A doctor may only create rows belonging to themselves.
 *
 * WITH CHECK on the NEW row is what stops a caller writing
 * `doctor_profile_id = <another doctor>` — the browser supplies that column and
 * the browser is never trusted.
 */
drop policy if exists doctor_medicines_insert on public.doctor_medicines;
create policy doctor_medicines_insert
  on public.doctor_medicines for insert to authenticated
  with check (doctor_profile_id = public.current_doctor_id());

/**
 * Both halves are required and do different jobs.
 *
 *   USING       which existing rows may be touched   -> only my own
 *   WITH CHECK  what the row may become              -> still my own
 *
 * Without WITH CHECK a doctor could take one of their own rows and re-assign it
 * to another doctor, injecting a default into someone else's library. Without
 * USING they could edit someone else's row into their own. Neither half is
 * redundant.
 */
drop policy if exists doctor_medicines_update on public.doctor_medicines;
create policy doctor_medicines_update
  on public.doctor_medicines for update to authenticated
  using (doctor_profile_id = public.current_doctor_id())
  with check (doctor_profile_id = public.current_doctor_id());

/**
 * NO DELETE POLICY, AND THE PRIVILEGE IS REVOKED.
 *
 * "Remove from My Medicines" archives (`is_active = false`). Two reasons, and
 * the second is the one that matters: a doctor who deletes a row loses the
 * defaults they spent months refining with no way back, and an archive keeps
 * `usage_count`/`last_used_at` intact so restoring is genuinely a restore.
 *
 * Archiving also cannot touch prescription history in either direction:
 * `prescription_items` stores its own copy of every printed field and holds no
 * foreign key to this table, so there is nothing here for an archive to break.
 */
revoke all on table public.doctor_medicines from anon;
revoke delete, truncate on table public.doctor_medicines from authenticated;
grant select, insert, update on table public.doctor_medicines to authenticated;

-- -----------------------------------------------------------------------------
-- Search.
-- -----------------------------------------------------------------------------

/**
 * The normalisation the DATABASE applies to a search query.
 *
 * It must fold a query exactly the way the generated columns fold the stored
 * text, or a search for "  NAPA " never matches a row keyed as "napa". Same
 * expression, stated once, used by the search function and asserted against the
 * TypeScript copy by the test suite.
 */
create or replace function public.normalize_medicine_text(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')));
$$;

/**
 * Escape a needle so `like` treats it as DATA, never as syntax.
 *
 * Without this a single `%` matches the entire catalogue, and `_` matches any
 * character — a doctor searching for a brand containing an underscore would
 * silently get a wider set than they asked for. Backslash first, or the escape
 * character introduced by the later replacements gets escaped in turn.
 */
create or replace function public.medicine_like_pattern(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

/**
 * Catalogue search.
 *
 * WHAT IT WILL AND WILL NOT DO.
 *
 * It matches literally, token by token: the query is split on whitespace and a
 * row is returned only if EVERY token literally appears in that row's text.
 * Nothing is corrected, expanded, transliterated or guessed. If the doctor
 * types a molecule that is not in the catalogue they get an empty result and
 * type the medicine themselves — which is the correct outcome, and far better
 * than being shown a plausible neighbour.
 *
 * WHY TOKENS AND NOT ONE STRING. A single contiguous match cannot find
 * "paracetamol 500" on a row that reads "paracetamol · napa · 500 mg", because
 * the brand sits between the two things the doctor typed. Found by running the
 * search rather than reading it. Requiring every token to appear is still
 * strictly literal — each one must be present, verbatim — so it widens what can
 * be FOUND without ever admitting a row the doctor did not describe.
 *
 * RANKING IS PRESENTATION, NOT SELECTION. Rows that start with the query sort
 * above rows that merely contain it, and generic matches above brand matches,
 * because that is the order a doctor scans. Every returned row still matched
 * literally; ranking never introduces a row and never picks one.
 *
 * SECURITY INVOKER (the default). This function is not `security definer`, so
 * the caller's own RLS applies to the select inside it — `anon` has no grant on
 * the table and this function is not granted to `anon` either.
 *
 * `p_country` is optional and defaults to NULL = every market. The catalogue is
 * multi-country by construction; a caller that wants one market passes its
 * ISO 3166-1 alpha-2 code.
 */
create or replace function public.search_medicines(
  p_query   text,
  p_country text default null,
  p_limit   int  default 25
)
returns table (
  id              uuid,
  generic_name    text,
  brand_name      text,
  strength_text   text,
  dosage_form     text,
  manufacturer    text,
  country_code    text,
  regulator_name  text,
  source_kind     public.medicine_source_kind,
  last_verified_at timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  with q as (
    select
      public.normalize_medicine_text(p_query) as needle,
      -- Upper-cased so a caller passing 'bd' filters the same as 'BD'.
      nullif(upper(btrim(coalesce(p_country, ''))), '') as country,
      -- A caller cannot ask for an unbounded scan. 1..100.
      least(greatest(coalesce(p_limit, 25), 1), 100) as lim
  )
  select
    m.id, m.generic_name, m.brand_name, m.strength_text, m.dosage_form,
    m.manufacturer, m.country_code, m.regulator_name, m.source_kind,
    m.last_verified_at
  from public.medicine_references m, q
  where
    -- Two characters minimum: a one-letter query returns the catalogue, which
    -- is a scan, not a search.
    length(q.needle) >= 2
    and (q.country is null or m.country_code = q.country)
    /*
      EVERY token must literally appear. `bool_and` over the tokens, with each
      one escaped so `%` and `_` are data rather than syntax. No regex, no
      similarity threshold, no fuzzy operator anywhere in this predicate — and
      an empty token list would make `bool_and` return NULL, so the length guard
      above is what keeps that case out.
    */
    and (
      select bool_and(
        m.search_text like '%' || public.medicine_like_pattern(tok) || '%'
      )
      from unnest(string_to_array(q.needle, ' ')) as tok
      where tok <> ''
    )
  order by
    /*
      Generic-first, prefix-first. Presentation order over an ALREADY-MATCHED
      set: ranking never introduces a row and never picks one. Measured against
      the whole query, so an exact "napa" beats a row that merely contains it.
    */
    case
      when m.generic_normalized like public.medicine_like_pattern(q.needle) || '%' then 0
      when m.brand_normalized   like public.medicine_like_pattern(q.needle) || '%' then 1
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
revoke all on function public.medicine_like_pattern(text)   from public, anon;
revoke all on function public.search_medicines(text, text, int) from public, anon;
grant execute on function public.normalize_medicine_text(text) to authenticated;
grant execute on function public.medicine_like_pattern(text)   to authenticated;
grant execute on function public.search_medicines(text, text, int) to authenticated;

comment on function public.search_medicines(text, text, int) is
  'Literal (prefix/substring) catalogue search. Never fuzzy: a search must not '
  'offer a different molecule than the one typed. Reference data only — this '
  'function has no authority over prescriptions and returns no clinical advice.';

/**
 * "I used this one" — the only thing that moves a row up the recently-used list.
 *
 * SECURITY DEFINER with a pinned search_path, and it re-checks ownership itself
 * rather than trusting the caller: a definer function does NOT inherit RLS, so
 * the rule the policy enforces is restated here in full. It touches exactly two
 * bookkeeping columns and can change nothing clinical.
 *
 * A plain UPDATE would also have worked under the policy above. This exists so
 * that "used" is an explicit act with one implementation, and so a browse or a
 * search can never be mistaken for one — an idle search must not silently
 * reorder a doctor's library.
 */
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
    -- 42501 = insufficient_privilege. Never 40001: this is a deterministic
    -- refusal, and PostgREST retries serialization failures.
    raise exception 'Only a doctor may record medicine usage'
      using errcode = '42501';
  end if;

  update public.doctor_medicines
     set usage_count = usage_count + 1,
         -- clock_timestamp(), not now(): now() is the transaction's start time,
         -- so a batch would stamp several rows identically.
         last_used_at = clock_timestamp(),
         updated_at   = clock_timestamp()
   where id = p_id
     and doctor_profile_id = v_doctor;

  -- Silent on no-match, deliberately. Answering "that row is not yours" and
  -- "that row does not exist" differently would let a caller probe for the
  -- existence of another doctor's saved medicines — a count is still a
  -- disclosure, and so is a distinguishable error.
end;
$$;

revoke all on function public.touch_doctor_medicine(uuid) from public, anon;
grant execute on function public.touch_doctor_medicine(uuid) to authenticated;

comment on function public.touch_doctor_medicine(uuid) is
  'Increments usage bookkeeping on the CALLER''S OWN saved medicine. Re-checks '
  'ownership internally (definer functions do not inherit RLS). Writes no '
  'clinical data and confers no prescribing authority.';
