-- =============================================================================
-- 0041 — Patient Documents (Module D, Phase D1).
--
-- THE RULE, unchanged from 0016: only the OWNING DOCTOR reads clinical content.
--
-- A document is a patient-scoped clinical asset. `patients.owner_doctor_id` is
-- the boundary it inherits, and there is no second branch — not a colleague at
-- the same hospital, not the location administrator, not reception. This is not
-- a shared drive and it has no folder that anyone can be added to.
--
-- STAFF AUTHORITY IN V1: NONE.
--
-- The brief allows operational staff "only where explicitly required for the
-- upload workflow". Nothing in D1 requires it — the doctor uploads — so nothing
-- is granted. A staff upload path added later is a NEW, narrow function that
-- writes a row it cannot then read back, not a widening of these policies. The
-- upload-side extension point is named at `patient_documents_storage_insert`.
--
-- WRITES ARE RPC-ONLY. The verbs are revoked and no write policy exists, so
-- there is no direct path a later GRANT could quietly re-open. Each function is
-- SECURITY DEFINER with a pinned search_path and restates every rule it
-- bypasses, and writes its audit row in the SAME transaction — clinical
-- document metadata is on ADR 0007's fail-closed list, so `emitAudit` (which
-- swallows failures by design) is the wrong mechanism here.
--
-- Idempotent. Run with `npm run db:policies`, verify with `npm run db:verify`
-- and `npm run db:verify:documents`.
-- =============================================================================

alter table public.patient_documents enable row level security;
alter table public.patient_documents force  row level security;

revoke all on public.patient_documents from anon;

-- -----------------------------------------------------------------------------
-- READ — the owning doctor, and nobody else.
--
-- `owner_doctor_id = current_doctor_id()` rather than a call to
-- `owns_patient(patient_id)`: the stored column is guaranteed correct by the
-- composite foreign key on (patient_id, owner_doctor_id), it is the leading
-- column of `patient_documents_owner_idx`, and a policy that calls a function
-- once per candidate row cannot use an index — "list my documents" would walk
-- every doctor's rows to discard them.
-- -----------------------------------------------------------------------------
drop policy if exists patient_documents_select on public.patient_documents;
create policy patient_documents_select
  on public.patient_documents for select to authenticated
  using (owner_doctor_id = public.current_doctor_id());

grant select on public.patient_documents to authenticated;
revoke insert, update, delete on public.patient_documents from authenticated;

/**
 * Does the caller own this document?
 *
 * SECURITY DEFINER so the write functions can ask without a second read, and it
 * answers one boolean. It leaks nothing: false is returned identically for
 * "belongs to another doctor" and "does not exist".
 */
create or replace function public.owns_patient_document(target_document uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.patient_documents d
    where d.id = target_document
      and d.owner_doctor_id = public.current_doctor_id()
  );
$$;

revoke all on function public.owns_patient_document(uuid) from public, anon;
grant execute on function public.owns_patient_document(uuid) to authenticated;

-- =============================================================================
-- STORAGE — a PRIVATE bucket, and the only bucket a patient document lives in.
--
-- Path convention, enforced on both sides:
--
--     <owning doctor's auth user id>/<patient id>/<random uuid>.<ext>
--
-- The first segment is the authority the storage policies check, and it is the
-- OWNING DOCTOR's user id — not "whoever uploaded". Today those are the same
-- person; writing the policy against the owner is what lets a future
-- receptionist or patient upload change the INSERT rule alone and leave the
-- read rule already correct.
--
-- The third segment is a fresh uuid, never the original filename. A filename is
-- attacker-controlled text: it must not choose a path, an extension, a content
-- type, or anything else that carries authority.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-documents', 'patient-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public             = false,           -- never let this flip to public
  file_size_limit    = 10485760,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

/**
 * READ. Also what gates `createSignedUrl` — Supabase requires SELECT on the
 * object before it will sign one, so a signed link cannot be minted for an
 * object the caller could not have read. The link is short-lived and the raw
 * path never reaches a browser.
 */
drop policy if exists patient_documents_storage_select on storage.objects;
create policy patient_documents_storage_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/**
 * WRITE. THE EXTENSION POINT.
 *
 * `= auth.uid()` reads as "you may only write inside your own folder", and for
 * a doctor uploading their own patient's report that is exactly right. When
 * reception or a patient uploads, the owning doctor's folder is NOT theirs, and
 * this predicate must grow a second branch that proves the relationship —
 * never a wildcard, and never a widening of the SELECT policy above.
 */
drop policy if exists patient_documents_storage_insert on storage.objects;
create policy patient_documents_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/**
 * NO UPDATE AND NO DELETE POLICY, DELIBERATELY.
 *
 * A stored clinical document is evidence. The application archives; it never
 * destroys. Without a policy, `remove()` deletes nothing — and it does so
 * SILENTLY, returning an empty list with no error, which is why the delete path
 * that exists (orphan cleanup after a failed metadata write) confirms from the
 * returned rows and never from the absence of an error.
 *
 * The dropped names below are for re-runs of an earlier draft of this file.
 */
drop policy if exists patient_documents_storage_update on storage.objects;
drop policy if exists patient_documents_storage_delete on storage.objects;

-- =============================================================================
-- THE WRITE PATH
-- =============================================================================

/**
 * The audit row for a document, written INSIDE the transaction that changes it.
 *
 * Carries ids, sizes and content type only. NEVER the title, the filename, the
 * notes or the document type: `audit_events` is readable by a LOCATION_ADMIN at
 * the location, and "IMAGING_REPORT for patient X" is a clinical disclosure to
 * someone who may not read the document itself (ADR 0007, ADR 0010).
 *
 * Ungranted — reachable only from the functions below.
 */
create or replace function public.log_document_audit(
  p_document_id          uuid,
  p_practice_location_id uuid,
  p_action               text,
  p_meta                 jsonb
)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    p_practice_location_id, auth.uid(), p_action, 'patient_document', p_document_id,
    coalesce(p_meta, '{}'::jsonb)
  );
$$;

revoke all on function public.log_document_audit(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

/**
 * Record an uploaded document.
 *
 * `owner_doctor_id` IS NOT A PARAMETER. It is read from the patient row, so a
 * caller cannot name a doctor — and the composite foreign key then makes the
 * stored value unfalsifiable even against a direct write.
 *
 * The object is already in storage when this runs. Storage RLS proved the
 * caller owned the folder; this proves the folder was the right one, that the
 * patient is theirs, and that the bytes were of a kind we accept. Both walls
 * are needed: neither one alone answers "is this the doctor's own patient".
 */
create or replace function public.create_patient_document(
  p_patient_id           uuid,
  p_practice_location_id uuid,
  p_encounter_id         uuid,
  p_document_type        public.document_type,
  p_title                text,
  p_document_date        date,
  p_notes                text,
  p_storage_path         text,
  p_mime_type            text,
  p_size_bytes           integer,
  p_original_filename    text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_uid    uuid := auth.uid();
  v_title  text := btrim(coalesce(p_title, ''));
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
  v_name   text := btrim(coalesce(p_original_filename, ''));
  v_parts  text[];
  v_id     uuid;
begin
  if v_doctor is null then
    raise exception 'only a doctor may file a patient document' using errcode = '42501';
  end if;

  /**
   * ONE MESSAGE for "no such patient", "not your patient" and "you do not
   * practise there". Distinguishing them would let a caller enumerate which
   * patient ids exist and who they belong to — a count is a disclosure, and so
   * is a differently-worded refusal.
   */
  if not public.owns_patient(p_patient_id)
     or not public.doctor_practises_at(v_doctor, p_practice_location_id) then
    raise exception 'document target not found' using errcode = '42501';
  end if;

  -- The encounter must be the SAME patient's and the caller's own. A foreign
  -- key cannot say "and the same patient", so it is said here.
  if p_encounter_id is not null then
    if not exists (
      select 1 from public.encounters e
      where e.id = p_encounter_id
        and e.owner_doctor_id = v_doctor
        and e.patient_id      = p_patient_id
    ) then
      raise exception 'document target not found' using errcode = '42501';
    end if;
  end if;

  if p_mime_type is null
     or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'DOCUMENT_MIME_REJECTED' using errcode = '22023';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception 'DOCUMENT_TOO_LARGE' using errcode = '22023';
  end if;

  if length(v_title) < 1 or length(v_title) > 200 then
    raise exception 'DOCUMENT_TITLE_INVALID' using errcode = '22023';
  end if;

  if length(coalesce(v_notes, '')) > 2000 then
    raise exception 'DOCUMENT_NOTES_INVALID' using errcode = '22023';
  end if;

  if length(v_name) < 1 or length(v_name) > 255 then
    raise exception 'DOCUMENT_FILENAME_INVALID' using errcode = '22023';
  end if;

  /**
   * A clinical date the document cannot have. Tomorrow is allowed because the
   * caller's clock and the clinic's day can legitimately differ by hours; next
   * month is a typo, and a typo in a date is how a report files itself out of
   * order and is never seen again.
   */
  if p_document_date is not null and p_document_date > (current_date + 1) then
    raise exception 'DOCUMENT_DATE_INVALID' using errcode = '22023';
  end if;

  /**
   * THE PATH IS RE-DERIVED, NOT TRUSTED.
   *
   * Exactly three segments: the caller's own auth id, this patient, and a uuid
   * with an extension we accept. Anything else — a traversal, another patient's
   * folder, a filename smuggled into the last segment — is refused. Storage RLS
   * already confined the write to segment one; this pins the other two, so a
   * metadata row can never describe an object it does not own.
   */
  v_parts := string_to_array(p_storage_path, '/');
  if array_length(v_parts, 1) is distinct from 3
     or v_parts[1] is distinct from v_uid::text
     or v_parts[2] is distinct from p_patient_id::text
     or v_parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$'
  then
    raise exception 'DOCUMENT_PATH_INVALID' using errcode = '22023';
  end if;

  insert into public.patient_documents (
    patient_id, owner_doctor_id, practice_location_id, encounter_id,
    document_type, title, document_date, notes,
    storage_path, mime_type, size_bytes, original_filename, uploaded_by
  ) values (
    p_patient_id,
    -- DERIVED. Not a parameter, so nobody can name another doctor.
    (select p.owner_doctor_id from public.patients p where p.id = p_patient_id),
    p_practice_location_id, p_encounter_id,
    coalesce(p_document_type, 'OTHER'), v_title, p_document_date, v_notes,
    p_storage_path, p_mime_type, p_size_bytes, v_name, v_uid
  )
  returning id into v_id;

  perform public.log_document_audit(
    v_id, p_practice_location_id, 'document.uploaded',
    jsonb_build_object(
      'patient_id',       p_patient_id,
      'mime_type',        p_mime_type,
      'size_bytes',       p_size_bytes,
      'linked_encounter', p_encounter_id is not null
    )
  );

  return v_id;
end;
$$;

revoke all on function public.create_patient_document(
  uuid, uuid, uuid, public.document_type, text, date, text, text, text, integer, text
) from public, anon;
grant execute on function public.create_patient_document(
  uuid, uuid, uuid, public.document_type, text, date, text, text, text, integer, text
) to authenticated;

/**
 * Archive a document. THIS IS THE ONLY REMOVAL THE PRODUCT HAS.
 *
 * The row stays, the stored object stays, and both the actor and the reason are
 * recorded (ADR 0015). A wrong document attached to the wrong patient is a real
 * and urgent problem, so it must be removable from the working record — but a
 * clinical asset that a single click destroys forever is a worse one, and it is
 * the failure that cannot be undone.
 */
create or replace function public.archive_patient_document(
  p_document_id uuid,
  p_reason      text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc    public.patient_documents%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'DOCUMENT_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into v_doc from public.patient_documents
  where id = p_document_id for update;

  -- Missing and not-yours answer identically, as everywhere else here.
  if not found or v_doc.owner_doctor_id is distinct from public.current_doctor_id() then
    raise exception 'document not found' using errcode = '42501';
  end if;

  /**
   * A deterministic refusal, so P0001 — never 40001. `serialization_failure`
   * means "transient, retrying may succeed", and PostgREST duly retries it,
   * which turns one rejected click into a retry storm.
   */
  if v_doc.archived_at is not null then
    raise exception 'DOCUMENT_ALREADY_ARCHIVED';
  end if;

  update public.patient_documents
     set archived_at    = now(),
         archived_by    = auth.uid(),
         archive_reason = v_reason,
         updated_at     = now()
   where id = p_document_id;

  perform public.log_document_audit(
    p_document_id, v_doc.practice_location_id, 'document.archived',
    jsonb_build_object('patient_id', v_doc.patient_id)
  );
end;
$$;

revoke all on function public.archive_patient_document(uuid, text) from public, anon;
grant execute on function public.archive_patient_document(uuid, text) to authenticated;

/** Undo an archive. The counterpart that makes archiving safe to reach for. */
create or replace function public.restore_patient_document(p_document_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc public.patient_documents%rowtype;
begin
  select * into v_doc from public.patient_documents
  where id = p_document_id for update;

  if not found or v_doc.owner_doctor_id is distinct from public.current_doctor_id() then
    raise exception 'document not found' using errcode = '42501';
  end if;

  if v_doc.archived_at is null then
    raise exception 'DOCUMENT_NOT_ARCHIVED';
  end if;

  update public.patient_documents
     set archived_at    = null,
         archived_by    = null,
         archive_reason = null,
         updated_at     = now()
   where id = p_document_id;

  perform public.log_document_audit(
    p_document_id, v_doc.practice_location_id, 'document.restored',
    jsonb_build_object('patient_id', v_doc.patient_id)
  );
end;
$$;

revoke all on function public.restore_patient_document(uuid) from public, anon;
grant execute on function public.restore_patient_document(uuid) to authenticated;
