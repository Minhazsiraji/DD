/**
 * Prescription V2 — module configuration and saved phrases.
 *
 * Both tables answer the same question: "what does THIS doctor prefer?" So both
 * carry `doctor_profile_id` and nothing else that could scope them, and every
 * policy below resolves through `current_doctor_id()`.
 *
 * NEITHER TABLE HOLDS PATIENT DATA. A module row is a preference; a phrase is
 * the doctor's own wording, written by them, for their own reuse. Nothing here
 * is about a person being treated, which is why none of it carries
 * `practice_location_id` and why staff have no reason to read any of it.
 *
 * See ADR 0013 for why module configuration is a separate table from
 * `prescription_templates` rather than more columns on it.
 */

alter table public.doctor_prescription_modules enable row level security;
alter table public.doctor_phrases              enable row level security;

-- -----------------------------------------------------------------------------
-- READ: the owning doctor, and nobody else at all.
--
-- Not "staff at the same location", not "an administrator". A receptionist has
-- no use for a doctor's saved examination wording, and a location admin editing
-- a doctor's prescription layout would be the clinic overruling the clinician
-- on their own signed document.
-- -----------------------------------------------------------------------------
drop policy if exists doctor_rx_modules_select on public.doctor_prescription_modules;
create policy doctor_rx_modules_select
  on public.doctor_prescription_modules for select to authenticated
  using (doctor_profile_id = public.current_doctor_id());

drop policy if exists doctor_phrases_select on public.doctor_phrases;
create policy doctor_phrases_select
  on public.doctor_phrases for select to authenticated
  using (doctor_profile_id = public.current_doctor_id());

-- -----------------------------------------------------------------------------
-- WRITES ARE RPC-ONLY.
--
-- Supabase grants `authenticated` every verb on a new table by default, so
-- omitting one from a GRANT does not remove it — each must be revoked. No write
-- policy exists: one would advertise a direct path that must not be taken, and
-- would let a later GRANT quietly reopen it.
-- -----------------------------------------------------------------------------
grant select on public.doctor_prescription_modules to authenticated;
grant select on public.doctor_phrases              to authenticated;
revoke insert, update, delete on public.doctor_prescription_modules from authenticated, anon;
revoke insert, update, delete on public.doctor_phrases              from authenticated, anon;
revoke all on public.doctor_prescription_modules from anon;
revoke all on public.doctor_phrases              from anon;

-- -----------------------------------------------------------------------------
-- The default configuration.
--
-- Chosen to reproduce TODAY'S PRINTED OUTPUT for an existing doctor, so that
-- installing V2 changes nothing until the doctor decides to change something.
-- Diagnosis, investigations and advice print because they print today; the
-- narrative sections are used but not printed, which is what the pilot doctor
-- described wanting; allergy and long-term medicines are OFF because they are
-- patient-level facts and printing them freezes them (ADR 0013 §5).
-- -----------------------------------------------------------------------------
create or replace function public.default_rx_modules()
returns table (
  module                   public.rx_module,
  use_during_consultation  boolean,
  show_on_print            boolean,
  "position"               integer
)
language sql
immutable
as $$
  values
    ('CHIEF_COMPLAINT'::public.rx_module,     true,  true,   10),
    ('SYMPTOMS'::public.rx_module,            false, false,  20),
    ('HISTORY'::public.rx_module,             true,  false,  30),
    ('VITALS'::public.rx_module,              true,  false,  40),
    ('EXAMINATION'::public.rx_module,         true,  false,  50),
    ('ASSESSMENT'::public.rx_module,          true,  false,  60),
    ('DIAGNOSIS'::public.rx_module,           true,  true,   70),
    ('INVESTIGATIONS'::public.rx_module,      true,  true,   80),
    ('ADVICE'::public.rx_module,              true,  true,   90),
    ('NEXT_VISIT'::public.rx_module,          true,  true,  100),
    ('ALLERGY'::public.rx_module,             false, false, 110),
    ('LONG_TERM_MEDICINES'::public.rx_module, false, false, 120);
$$;

revoke all on function public.default_rx_modules() from public, anon, authenticated;

/**
 * The caller's module configuration, filling in anything they have never
 * touched.
 *
 * A doctor who has never opened the settings screen has NO rows, and a missing
 * row must mean "the default" rather than "hidden" — otherwise shipping a new
 * module would silently blank part of every existing doctor's prescription.
 * Resolved here rather than by seeding rows at migration time, so a module
 * added later is defaulted for everyone without a backfill.
 */
create or replace function public.doctor_rx_modules()
returns table (
  module                   public.rx_module,
  use_during_consultation  boolean,
  show_on_print            boolean,
  "position"               integer,
  print_label              text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    d.module,
    coalesce(m.use_during_consultation, d.use_during_consultation),
    coalesce(m.show_on_print,           d.show_on_print),
    coalesce(m."position",              d."position"),
    m.print_label
  from public.default_rx_modules() d
  left join public.doctor_prescription_modules m
    on m.module = d.module
   and m.doctor_profile_id = public.current_doctor_id()
  order by coalesce(m."position", d."position"), d.module;
$$;

revoke all on function public.doctor_rx_modules() from public, anon;
grant execute on function public.doctor_rx_modules() to authenticated;

/**
 * Save the caller's whole module configuration in one write.
 *
 * ONE ROUND TRIP for the whole screen, not one per toggle: reordering twelve
 * modules must not be twelve clinical writes, and a half-applied reorder is a
 * state nobody asked for.
 *
 * There is NO doctor id parameter. `current_doctor_id()` decides whose
 * configuration this is — a caller-supplied identity on a write is how one
 * doctor edits another.
 */
create or replace function public.save_rx_modules(p_modules jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid;
  v_row    jsonb;
  v_label  text;
  v_count  integer := 0;
begin
  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    raise exception 'only a doctor has a prescription layout' using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_modules, '[]'::jsonb))
  loop
    /**
     * PLAIN TEXT ONLY. This string becomes a heading on a clinical document,
     * so anything that could carry markup is refused rather than escaped —
     * escaping is a decision made in one renderer and forgotten in the next.
     */
    v_label := nullif(btrim(coalesce(v_row ->> 'printLabel', '')), '');
    if v_label is not null then
      if length(v_label) > 40 then
        raise exception 'LABEL_TOO_LONG' using errcode = '22023';
      end if;
      if v_label ~ '[<>&"]' then
        raise exception 'LABEL_INVALID' using errcode = '22023';
      end if;
    end if;

    insert into public.doctor_prescription_modules
      (doctor_profile_id, module, use_during_consultation, show_on_print, position, print_label)
    values (
      v_doctor,
      (v_row ->> 'module')::public.rx_module,
      coalesce((v_row ->> 'useDuringConsultation')::boolean, true),
      coalesce((v_row ->> 'showOnPrint')::boolean, false),
      coalesce((v_row ->> 'position')::integer, 0),
      v_label
    )
    on conflict (doctor_profile_id, module) do update set
      use_during_consultation = excluded.use_during_consultation,
      show_on_print           = excluded.show_on_print,
      position                = excluded.position,
      print_label             = excluded.print_label,
      updated_at              = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.save_rx_modules(jsonb) from public, anon;
grant execute on function public.save_rx_modules(jsonb) to authenticated;

/**
 * Save a phrase, or bump the one that already exists.
 *
 * Called when the doctor SAVES or APPLIES one — never while typing. The unique
 * index is on the DERIVED normalised text, so "Bed rest" and "bed  rest" are
 * one row rather than two entries in a list meant to save time.
 */
create or replace function public.save_rx_phrase(
  p_kind public.rx_phrase_kind,
  p_text text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid;
  v_text   text;
  v_id     uuid;
begin
  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    raise exception 'only a doctor keeps saved phrases' using errcode = '42501';
  end if;

  -- Stored EXACTLY as typed. Only the comparison key is folded, and that is
  -- derived by the database.
  v_text := btrim(coalesce(p_text, ''));
  if v_text = '' then
    raise exception 'PHRASE_EMPTY' using errcode = '22023';
  end if;
  if length(v_text) > 200 then
    raise exception 'PHRASE_TOO_LONG' using errcode = '22023';
  end if;

  insert into public.doctor_phrases (doctor_profile_id, kind, text, usage_count, last_used_at)
  values (v_doctor, p_kind, v_text, 1, now())
  on conflict (doctor_profile_id, kind, text_normalized) do update set
    usage_count  = public.doctor_phrases.usage_count + 1,
    last_used_at = now(),
    is_active    = true
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_rx_phrase(public.rx_phrase_kind, text) from public, anon;
grant execute on function public.save_rx_phrase(public.rx_phrase_kind, text) to authenticated;

/** Retire a phrase without losing the fact that it was once used. */
create or replace function public.retire_rx_phrase(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid;
begin
  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    raise exception 'only a doctor keeps saved phrases' using errcode = '42501';
  end if;

  -- Scoped by owner in the UPDATE itself: a phrase id from another doctor
  -- matches nothing rather than raising something that confirms it exists.
  update public.doctor_phrases
     set is_active = false
   where id = p_id and doctor_profile_id = v_doctor;
end;
$$;

revoke all on function public.retire_rx_phrase(uuid) from public, anon;
grant execute on function public.retire_rx_phrase(uuid) to authenticated;
