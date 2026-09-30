-- 0056 — Patient Documents V2: immutable bytes, delegated upload, durable access audit.
-- No hard-delete path is introduced. Clinical read authority remains least-privilege.

alter type public.location_role add value if not exists 'ASSISTANT';
alter table public.patient_documents add column if not exists sha256 text;
update public.patient_documents set sha256 = repeat('0',64) where sha256 is null;
alter table public.patient_documents alter column sha256 set not null;
alter table public.patient_documents drop constraint if exists patient_documents_sha256;
alter table public.patient_documents add constraint patient_documents_sha256 check (sha256 ~ '^[0-9a-f]{64}$');
create index if not exists patient_documents_owner_archive_created_idx
  on public.patient_documents(owner_doctor_id, archived_at, created_at desc);
create index if not exists patient_documents_patient_archive_created_idx
  on public.patient_documents(patient_id, archived_at, created_at desc);
create index if not exists patient_documents_location_idx on public.patient_documents(practice_location_id);
create index if not exists patient_documents_uploaded_by_idx on public.patient_documents(uploaded_by);
create index if not exists patient_documents_archived_by_idx on public.patient_documents(archived_by);

-- A staff member may upload only where the owning doctor is also an active doctor.
-- A patient may upload only to their own linked record/location. Upload != read.
create or replace function public.can_upload_patient_document(
  p_patient_id uuid, p_practice_location_id uuid
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.patients p
    join public.doctor_profiles d on d.id = p.owner_doctor_id
    where p.id = p_patient_id and (
      d.user_id = auth.uid()
      or (
        exists (select 1 from public.practice_location_members me
          where me.practice_location_id=p_practice_location_id and me.user_id=auth.uid()
            and me.status='ACTIVE' and me.role in ('ASSISTANT','RECEPTIONIST'))
        and exists (select 1 from public.practice_location_members od
          where od.practice_location_id=p_practice_location_id and od.user_id=d.user_id
            and od.status='ACTIVE' and od.role='DOCTOR')
      )
      or (
        p.patient_account_id = auth.uid()
        and exists (select 1 from public.patient_location_links l
          where l.patient_id=p.id and l.practice_location_id=p_practice_location_id)
      )
    )
  );
$$;
revoke all on function public.can_upload_patient_document(uuid,uuid) from public, anon;
grant execute on function public.can_upload_patient_document(uuid,uuid) to authenticated;

create or replace function public.get_patient_document_upload_context(
  p_patient_id uuid, p_practice_location_id uuid
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_owner_user uuid;
begin
  if not public.can_upload_patient_document(p_patient_id,p_practice_location_id) then
    raise exception 'DOCUMENT_UPLOAD_FORBIDDEN' using errcode='42501';
  end if;
  select d.user_id into v_owner_user from public.patients p
    join public.doctor_profiles d on d.id=p.owner_doctor_id where p.id=p_patient_id;
  return jsonb_build_object('owner_user_id',v_owner_user);
end $$;
revoke all on function public.get_patient_document_upload_context(uuid,uuid) from public,anon;
grant execute on function public.get_patient_document_upload_context(uuid,uuid) to authenticated;

-- Storage path is owner-user/patient/location/random.ext. The uploader can write once,
-- but only the owning doctor (and separately authorized patient read policy, if enabled)
-- may read. There remains no UPDATE or DELETE storage policy.
drop policy if exists patient_documents_storage_insert on storage.objects;
create policy patient_documents_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id='patient-documents'
  and array_length(storage.foldername(name),1)=3
  and (storage.foldername(name))[1] = (
    select d.user_id::text from public.patients p join public.doctor_profiles d on d.id=p.owner_doctor_id
    where p.id=((storage.foldername(name))[2])::uuid
  )
  and public.can_upload_patient_document(
    ((storage.foldername(name))[2])::uuid,
    ((storage.foldername(name))[3])::uuid
  )
);
drop policy if exists patient_documents_storage_update on storage.objects;
drop policy if exists patient_documents_storage_delete on storage.objects;

-- Clinical readers: owning doctor or the linked patient account. Staff upload authority
-- deliberately does not become read authority.
drop policy if exists patient_documents_select on public.patient_documents;
create policy patient_documents_select on public.patient_documents for select to authenticated using (
  owner_doctor_id=public.current_doctor_id()
  or exists(select 1 from public.patients p where p.id=patient_id and p.patient_account_id=(select auth.uid()))
);
drop policy if exists patient_documents_storage_select on storage.objects;
create policy patient_documents_storage_select on storage.objects for select to authenticated using (
  bucket_id='patient-documents' and (
    (storage.foldername(name))[1]=auth.uid()::text
    or exists(select 1 from public.patients p
      where p.id=((storage.foldername(name))[2])::uuid and p.patient_account_id=(select auth.uid()))
  )
);

-- Replace D1 doctor-only writer with a delegated, still patient-scoped writer.
drop function if exists public.create_patient_document(uuid,uuid,uuid,public.document_type,text,date,text,text,text,integer,text);
create or replace function public.create_patient_document(
  p_patient_id uuid, p_practice_location_id uuid, p_encounter_id uuid,
  p_document_type public.document_type, p_title text, p_document_date date, p_notes text,
  p_storage_path text, p_mime_type text, p_size_bytes integer, p_sha256 text,
  p_original_filename text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid := gen_random_uuid(); v_owner uuid; v_owner_user uuid; v_parts text[];
  v_title text:=btrim(coalesce(p_title,'')); v_notes text:=nullif(btrim(coalesce(p_notes,'')),'');
  v_name text:=left(regexp_replace(coalesce(p_original_filename,'document'),'[[:cntrl:]/\\]+',' ','g'),255);
begin
  if not public.can_upload_patient_document(p_patient_id,p_practice_location_id) then
    raise exception 'DOCUMENT_UPLOAD_FORBIDDEN' using errcode='42501'; end if;
  select p.owner_doctor_id,d.user_id into v_owner,v_owner_user from public.patients p
    join public.doctor_profiles d on d.id=p.owner_doctor_id where p.id=p_patient_id;
  if p_encounter_id is not null and not exists(select 1 from public.encounters e
    where e.id=p_encounter_id and e.patient_id=p_patient_id and e.owner_doctor_id=v_owner) then
    raise exception 'DOCUMENT_ENCOUNTER_INVALID' using errcode='42501'; end if;
  if length(v_title) not between 1 and 200 then raise exception 'DOCUMENT_TITLE_INVALID'; end if;
  if v_notes is not null and length(v_notes)>2000 then raise exception 'DOCUMENT_NOTES_INVALID'; end if;
  if p_document_date>current_date then raise exception 'DOCUMENT_DATE_INVALID'; end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png') then raise exception 'DOCUMENT_MIME_REJECTED'; end if;
  if p_size_bytes<=0 or p_size_bytes>10485760 then raise exception 'DOCUMENT_TOO_LARGE'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'DOCUMENT_HASH_INVALID'; end if;
  v_parts:=string_to_array(p_storage_path,'/');
  if array_length(v_parts,1)<>4 or v_parts[1]<>v_owner_user::text or v_parts[2]<>p_patient_id::text
     or v_parts[3]<>p_practice_location_id::text or v_parts[4] !~ '^[0-9a-f-]{36}\\.(pdf|jpg|png)$' then
    raise exception 'DOCUMENT_PATH_INVALID'; end if;
  insert into public.patient_documents(
    id,patient_id,owner_doctor_id,practice_location_id,encounter_id,document_type,title,
    document_date,notes,storage_path,mime_type,size_bytes,sha256,original_filename,uploaded_by
  ) values (
    v_id,p_patient_id,v_owner,p_practice_location_id,p_encounter_id,p_document_type,v_title,
    p_document_date,v_notes,p_storage_path,p_mime_type,p_size_bytes,p_sha256,v_name,auth.uid()
  );
  insert into public.audit_events(practice_location_id,actor_id,action,resource_type,resource_id,meta)
  values(p_practice_location_id,auth.uid(),'document.uploaded','patient_document',v_id,
    jsonb_build_object('patient_id',p_patient_id,'owner_doctor_id',v_owner,'size_bytes',p_size_bytes,'mime_type',p_mime_type,'sha256',p_sha256));
  return v_id;
end $$;
revoke all on function public.create_patient_document(uuid,uuid,uuid,public.document_type,text,date,text,text,text,integer,text,text) from public,anon;
grant execute on function public.create_patient_document(uuid,uuid,uuid,public.document_type,text,date,text,text,text,integer,text,text) to authenticated;

-- Append-only lifecycle history. Restoring never erases the prior archive reason/actor/time.
create table if not exists public.patient_document_events(
  seq bigserial primary key, document_id uuid not null references public.patient_documents(id) on delete restrict,
  event_type text not null check(event_type in ('ARCHIVED','RESTORED')),
  actor_id uuid references public.profiles(id) on delete set null,
  reason text, at timestamptz not null default clock_timestamp(),
  constraint patient_document_events_reason check(
    (event_type='ARCHIVED' and reason is not null and length(btrim(reason)) between 5 and 500)
    or (event_type='RESTORED' and reason is null)
  )
);
create index if not exists patient_document_events_document_idx on public.patient_document_events(document_id,seq);
create index if not exists patient_document_events_actor_idx on public.patient_document_events(actor_id);
alter table public.patient_document_events enable row level security;
alter table public.patient_document_events force row level security;
revoke all on public.patient_document_events from anon,authenticated;
grant select on public.patient_document_events to authenticated;
create policy patient_document_events_select on public.patient_document_events for select to authenticated using(
  exists(select 1 from public.patient_documents d where d.id=document_id)
);

create or replace function public.archive_patient_document(p_document_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_doc public.patient_documents%rowtype; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if length(v_reason) not between 5 and 500 then raise exception 'DOCUMENT_ARCHIVE_REASON_INVALID'; end if;
  select * into v_doc from public.patient_documents where id=p_document_id for update;
  if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode='42501'; end if;
  if not (v_doc.owner_doctor_id=public.current_doctor_id()
    or v_doc.uploaded_by=auth.uid()
    or exists(select 1 from public.patients p where p.id=v_doc.patient_id and p.patient_account_id=(select auth.uid()))) then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode='42501'; end if;
  if v_doc.archived_at is not null then raise exception 'DOCUMENT_ALREADY_ARCHIVED'; end if;
  update public.patient_documents set archived_at=clock_timestamp(),archived_by=auth.uid(),archive_reason=v_reason,updated_at=clock_timestamp()
    where id=p_document_id;
  insert into public.patient_document_events(document_id,event_type,actor_id,reason) values(p_document_id,'ARCHIVED',auth.uid(),v_reason);
  insert into public.audit_events(practice_location_id,actor_id,action,resource_type,resource_id,meta)
    values(v_doc.practice_location_id,auth.uid(),'document.archived','patient_document',p_document_id,
      jsonb_build_object('patient_id',v_doc.patient_id,'owner_doctor_id',v_doc.owner_doctor_id));
end $$;
revoke all on function public.archive_patient_document(uuid,text) from public,anon;
grant execute on function public.archive_patient_document(uuid,text) to authenticated;

create or replace function public.restore_patient_document(p_document_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_doc public.patient_documents%rowtype;
begin
  select * into v_doc from public.patient_documents where id=p_document_id for update;
  if not found or v_doc.owner_doctor_id is distinct from public.current_doctor_id() then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode='42501'; end if;
  if v_doc.archived_at is null then raise exception 'DOCUMENT_NOT_ARCHIVED'; end if;
  update public.patient_documents set archived_at=null,archived_by=null,archive_reason=null,updated_at=clock_timestamp() where id=p_document_id;
  insert into public.patient_document_events(document_id,event_type,actor_id) values(p_document_id,'RESTORED',auth.uid());
  insert into public.audit_events(practice_location_id,actor_id,action,resource_type,resource_id,meta)
    values(v_doc.practice_location_id,auth.uid(),'document.restored','patient_document',p_document_id,
      jsonb_build_object('patient_id',v_doc.patient_id,'owner_doctor_id',v_doc.owner_doctor_id));
end $$;
revoke all on function public.restore_patient_document(uuid) from public,anon;
grant execute on function public.restore_patient_document(uuid) to authenticated;

-- Durable access audit: authorization is proven through the caller's RLS-visible row.
create or replace function public.log_patient_document_access(p_document_id uuid,p_action text,p_ip text default null,p_user_agent text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_doc public.patient_documents%rowtype;
begin
  if p_action not in ('document.viewed','document.downloaded','document.printed') then
    raise exception 'DOCUMENT_ACCESS_ACTION_INVALID'; end if;
  select * into v_doc from public.patient_documents d where d.id=p_document_id and (
    d.owner_doctor_id=public.current_doctor_id()
    or exists(select 1 from public.patients p where p.id=d.patient_id and p.patient_account_id=(select auth.uid()))
  );
  if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode='42501'; end if;
  insert into public.audit_events(practice_location_id,actor_id,action,resource_type,resource_id,ip,user_agent,meta)
    values(v_doc.practice_location_id,auth.uid(),p_action,'patient_document',p_document_id,left(p_ip,128),left(p_user_agent,512),
      jsonb_build_object('patient_id',v_doc.patient_id,'owner_doctor_id',v_doc.owner_doctor_id));
end $$;
revoke all on function public.log_patient_document_access(uuid,text,text,text) from public,anon;
grant execute on function public.log_patient_document_access(uuid,text,text,text) to authenticated;

-- Metadata/byte identity is immutable. Only archive-state fields may change.
create or replace function public.guard_patient_document_immutability() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.id is distinct from old.id or new.patient_id is distinct from old.patient_id
    or new.owner_doctor_id is distinct from old.owner_doctor_id
    or new.practice_location_id is distinct from old.practice_location_id
    or new.encounter_id is distinct from old.encounter_id
    or new.document_type is distinct from old.document_type or new.title is distinct from old.title
    or new.document_date is distinct from old.document_date or new.notes is distinct from old.notes
    or new.storage_path is distinct from old.storage_path or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes or new.sha256 is distinct from old.sha256
    or new.original_filename is distinct from old.original_filename or new.uploaded_by is distinct from old.uploaded_by
    or new.created_at is distinct from old.created_at then
      raise exception 'PATIENT_DOCUMENT_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists patient_documents_immutable on public.patient_documents;
create trigger patient_documents_immutable before update on public.patient_documents
for each row execute function public.guard_patient_document_immutability();
revoke update,delete,truncate on public.patient_documents from authenticated;

alter table public.patient_documents drop constraint if exists patient_documents_archive_consistent;
alter table public.patient_documents add constraint patient_documents_archive_consistent check(
  (archived_at is null and archived_by is null and archive_reason is null)
  or (archived_at is not null and archived_by is not null and archive_reason is not null and length(btrim(archive_reason)) between 5 and 500)
);

-- Legacy staff attachment remains authenticated-only; V2 must not leave this SECURITY DEFINER RPC callable by anon.
revoke execute on function public.staff_attach_document_record(uuid,uuid,uuid,uuid,public.document_type,text,date,text,text,text,integer,text) from public,anon;

-- Assistant needs only operational patient identity to choose the correct upload target.
-- This does not expose clinical child tables.
create or replace function public.can_access_patient(target_patient uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.can_access_patient_as(target_patient,array['ASSISTANT','RECEPTIONIST','LOCATION_ADMIN']::public.location_role[]);
$$;
drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients for select to authenticated using(
  owner_doctor_id=public.current_doctor_id()
  or exists(select 1 from public.patient_location_links l join public.practice_location_members m
    on m.practice_location_id=l.practice_location_id
    where l.patient_id=patients.id and m.user_id=auth.uid() and m.status='ACTIVE'
      and m.role=any(array['ASSISTANT','RECEPTIONIST','LOCATION_ADMIN']::public.location_role[]))
);
