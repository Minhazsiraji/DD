\set ON_ERROR_STOP on
create or replace function public.test_assert(ok boolean, message text) returns void
language plpgsql as $$ begin
  if not coalesce(ok,false) then raise exception 'ASSERT_FAIL: %', message; end if;
end $$;
create or replace function public.test_expect_error(command text, expected text) returns void
language plpgsql security invoker as $$
declare got text;
begin
  begin execute command; exception when others then got := sqlerrm; end;
  if got is null then raise exception 'EXPECTED_ERROR_NOT_RAISED: %', command; end if;
  if expected is not null and position(expected in got)=0 then
    raise exception 'WRONG_ERROR: expected %, got %', expected, got;
  end if;
end $$;

-- Synthetic identities only.
insert into public.profiles(id,full_name) values
('00000000-0000-0000-0000-000000000001','Doctor A'),
('00000000-0000-0000-0000-000000000002','Doctor B'),
('00000000-0000-0000-0000-000000000003','Managed Receptionist'),
('00000000-0000-0000-0000-000000000004','Legacy Receptionist'),
('00000000-0000-0000-0000-000000000005','Managed Assistant'),
('00000000-0000-0000-0000-000000000006','Location Admin'),
('00000000-0000-0000-0000-000000000007','Doctor B Staff');
insert into public.doctor_profiles(id,user_id) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into public.practice_locations(id,name) values
('20000000-0000-0000-0000-000000000001','Shared Location X'),
('20000000-0000-0000-0000-000000000002','Doctor A Location Y');
insert into public.practice_location_members(practice_location_id,user_id,role,status,joined_at) values
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','DOCTOR','ACTIVE',now()),
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','DOCTOR','ACTIVE',now()),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','DOCTOR','ACTIVE',now()),
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','RECEPTIONIST','ACTIVE',now()),
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','RECEPTIONIST','ACTIVE',now()),
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','LOCATION_ADMIN','ACTIVE',now());
insert into public.doctor_chambers(doctor_profile_id,practice_location_id,position) values
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',1),
('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',0);
insert into public.patients(id,owner_doctor_id,patient_number,full_name,name_normalized,created_by) values
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A-1','Patient A','patient a','00000000-0000-0000-0000-000000000001'),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','B-1','Patient B','patient b','00000000-0000-0000-0000-000000000002'),
('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','A-2','Patient A2','patient a2','00000000-0000-0000-0000-000000000001');
insert into public.patient_location_links(patient_id,practice_location_id) values
('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001'),
('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002');
insert into public.appointments(id,owner_doctor_id,practice_location_id,patient_id,scheduled_for,session_date,status,token_number,arrived_at,created_by)
values ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',now(),current_date,'ARRIVED',99,now(),'00000000-0000-0000-0000-000000000002');
insert into public.queue_entries(appointment_id,practice_location_id,session_date)
values('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',current_date);
insert into public.encounters(id,owner_doctor_id,patient_id,practice_location_id,status,created_by)
values('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','DRAFT','00000000-0000-0000-0000-000000000001');

-- Object, policy and privilege review.
select public.test_assert((select count(*)=3 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname in ('doctor_staff_role','doctor_staff_status','doctor_staff_permission')), 'three Staff enum types created');
select public.test_assert((select count(*)=5 from information_schema.tables where table_schema='public' and table_name in ('doctor_staff_invitations','doctor_staff_grants','doctor_staff_locations','doctor_staff_permissions','staff_investigation_proposals')), 'five Staff tables created');
select public.test_assert((select count(*)>=10 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'staff_%' or p.proname in ('managed_staff_entry_at','has_doctor_staff_permission','has_doctor_staff_permission_for_patient','service_link_doctor_staff_invitation','doctor_set_staff_status','doctor_replace_staff_permissions','doctor_replace_staff_locations'))), 'Staff functions created');
select public.test_assert((select count(*)=10 from pg_policies where schemaname='public' and policyname in ('doctor_staff_invitations_select_doctor','doctor_staff_invitations_insert_doctor','doctor_staff_grants_select_doctor','doctor_staff_locations_select_doctor','doctor_staff_permissions_select_doctor','staff_investigation_proposals_select_doctor_or_actor','doctor_chambers_select_team_staff','patients_select_team_staff','appointments_select_team_staff','queue_entries_select_team_staff')), 'expected Staff policies created');
select public.test_assert(exists(select 1 from pg_policies where schemaname='public' and policyname='audit_events_select_doctor_team'), 'Team audit policy created');
select public.test_assert(has_function_privilege('service_role','public.service_link_doctor_staff_invitation(uuid,uuid)','EXECUTE'), 'service role can link');
select public.test_assert(not has_function_privilege('authenticated','public.service_link_doctor_staff_invitation(uuid,uuid)','EXECUTE'), 'authenticated cannot service-link');
select public.test_assert(not has_function_privilege('anon','public.service_link_doctor_staff_invitation(uuid,uuid)','EXECUTE'), 'anon cannot service-link');
select public.test_assert(not has_table_privilege('anon','public.doctor_staff_grants','SELECT'), 'anon has no Staff table read');
select public.test_assert(not has_table_privilege('authenticated','public.doctor_staff_grants','INSERT'), 'authenticated cannot forge Staff grants');
select public.test_assert(not has_table_privilege('authenticated','public.doctor_staff_permissions','INSERT'), 'authenticated cannot forge Staff permissions');
select public.test_assert(not exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and
    (p.proname like 'staff_%' or p.proname like 'doctor_%staff%' or p.proname in ('managed_staff_entry_at','has_doctor_staff_permission','has_doctor_staff_permission_for_patient','service_link_doctor_staff_invitation'))
    and not ('search_path=public, pg_temp'=any(coalesce(p.proconfig,'{}'::text[])))
), 'all Staff SECURITY DEFINER functions pin public, pg_temp');

-- Doctor A creates an invitation: invitation alone grants no access.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
insert into public.doctor_staff_invitations(doctor_profile_id,email,role,requested_location_ids,requested_permissions,created_by)
values('10000000-0000-0000-0000-000000000001','managed.receptionist@qa.invalid','RECEPTIONIST',array['20000000-0000-0000-0000-000000000001']::uuid[],array['appointments.view','appointments.manage','patient.lookup','arrival.manage','queue.manage','chamber.view']::public.doctor_staff_permission[],'00000000-0000-0000-0000-000000000001') returning id as reception_invitation_id \gset
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_assert(not public.has_doctor_staff_permission('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','appointments.manage'), 'invitation alone grants nothing');
reset role;

-- Existing identity linking: no duplicate profile; legacy RECEPTIONIST is suspended only on explicit adoption.
select public.test_assert((select count(*)=1 from public.profiles where id='00000000-0000-0000-0000-000000000003'), 'existing staff identity unique before link');
set role service_role;
select public.service_link_doctor_staff_invitation(:'reception_invitation_id','00000000-0000-0000-0000-000000000003') as reception_grant_id \gset
reset role;
select public.test_assert((select count(*)=1 from public.profiles where id='00000000-0000-0000-0000-000000000003'), 'existing staff identity not duplicated');
select public.test_assert((select linked_user_id='00000000-0000-0000-0000-000000000003' from public.doctor_staff_invitations where id=:'reception_invitation_id'), 'invitation linked metadata stored');
select public.test_assert((select status='SUSPENDED' from public.practice_location_members where user_id='00000000-0000-0000-0000-000000000003' and practice_location_id='20000000-0000-0000-0000-000000000001' and role::text='RECEPTIONIST'), 'adopted legacy receptionist suspended');
select public.test_assert((select status='ACTIVE' from public.practice_location_members where user_id='00000000-0000-0000-0000-000000000003' and practice_location_id='20000000-0000-0000-0000-000000000001' and role::text='ASSISTANT'), 'managed inert entry active');
select public.test_assert((select status='ACTIVE' from public.practice_location_members where user_id='00000000-0000-0000-0000-000000000004' and role::text='RECEPTIONIST'), 'unadopted receptionist preserved');

-- Doctor B creates and links own Staff; Doctor A cannot manage that relationship.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select set_config('request.jwt.claim.aal','aal2',false);
insert into public.doctor_staff_invitations(doctor_profile_id,email,role,requested_location_ids,requested_permissions,created_by)
values('10000000-0000-0000-0000-000000000002','doctorb.staff@qa.invalid','RECEPTIONIST',array['20000000-0000-0000-0000-000000000001']::uuid[],array['appointments.view']::public.doctor_staff_permission[],'00000000-0000-0000-0000-000000000002') returning id as doctorb_invitation_id \gset
reset role;
set role service_role;
select public.service_link_doctor_staff_invitation(:'doctorb_invitation_id','00000000-0000-0000-0000-000000000007') as doctorb_grant_id \gset
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_expect_error(format('select public.doctor_set_staff_status(%L::uuid,%L::public.doctor_staff_status)', :'doctorb_grant_id','TEMPORARILY_DISABLED'),'STAFF_GRANT_NOT_FOUND');
select public.test_assert((select count(*)=1 from public.doctor_staff_grants where doctor_profile_id='10000000-0000-0000-0000-000000000001'), 'Doctor A sees own Team via RLS');
select public.test_assert((select count(*)=0 from public.doctor_staff_grants where doctor_profile_id='10000000-0000-0000-0000-000000000002'), 'Doctor A cannot see Doctor B Team via RLS');
reset role;

-- Managed receptionist positive booking/arrival/queue and shared-location isolation.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.staff_create_appointment('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',now()+interval '1 hour',15,'NEW','managed booking') as managed_appointment_id \gset
select public.test_expect_error($cmd$select public.staff_create_appointment('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',now()+interval '1 hour',15,'NEW','cross doctor')$cmd$,'STAFF_APPOINTMENT_MANAGE_FORBIDDEN');
select public.test_expect_error($cmd$select public.staff_create_appointment('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003',now()+interval '1 hour',15,'NEW','cross location')$cmd$,'STAFF_APPOINTMENT_MANAGE_FORBIDDEN');
select public.staff_set_appointment_status(:'managed_appointment_id','ARRIVED',null,null);
select public.staff_set_queue_priority(:'managed_appointment_id','20000000-0000-0000-0000-000000000001','ELDERLY',null);
select public.staff_call_patient(:'managed_appointment_id','20000000-0000-0000-0000-000000000001','call');
select public.staff_skip_patient(:'managed_appointment_id','20000000-0000-0000-0000-000000000001','skip');
select public.staff_call_patient(:'managed_appointment_id','20000000-0000-0000-0000-000000000001','recall');
select public.staff_clear_queue_priority(:'managed_appointment_id','20000000-0000-0000-0000-000000000001');
select public.test_assert((select count(*)=1 from public.staff_get_queue('20000000-0000-0000-0000-000000000001',current_date) where owner_doctor_id='10000000-0000-0000-0000-000000000001'), 'managed queue returns Doctor A row');
select public.test_assert((select count(*)=0 from public.staff_get_queue('20000000-0000-0000-0000-000000000001',current_date) where owner_doctor_id='10000000-0000-0000-0000-000000000002'), 'Doctor B queue row excluded at shared location');
select public.staff_reschedule_appointment(:'managed_appointment_id',now()+interval '4 hours',15,'reschedule') as managed_rescheduled_id \gset
reset role;
select public.test_assert((select count(distinct action)=7 and count(*) filter (where actor_id<>'00000000-0000-0000-0000-000000000003' or meta->>'doctor_profile_id'<>'10000000-0000-0000-0000-000000000001' or meta->>'staff_role'<>'RECEPTIONIST')=0 from public.audit_events where action in ('STAFF_APPOINTMENT_CREATED','STAFF_APPOINTMENT_STATUS_CHANGED','STAFF_APPOINTMENT_RESCHEDULED','STAFF_QUEUE_PRIORITY_SET','STAFF_QUEUE_CALLED','STAFF_QUEUE_SKIPPED','STAFF_QUEUE_PRIORITY_CLEARED')), 'Receptionist operational audit metadata includes actor, Doctor context, and role');

-- Permission omission and role ceiling fail closed.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.doctor_replace_staff_permissions(:'reception_grant_id',array['appointments.view','appointments.manage','patient.lookup','arrival.manage','chamber.view']::public.doctor_staff_permission[]);
select public.test_expect_error(format('select public.doctor_replace_staff_permissions(%L::uuid,array[%L]::public.doctor_staff_permission[])', :'reception_grant_id','intake.write'),'STAFF_PERMISSION_EXCEEDS_ROLE');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_expect_error(format('select public.staff_call_patient(%L::uuid,%L::uuid,null)', :'managed_appointment_id','20000000-0000-0000-0000-000000000001'),'STAFF_QUEUE_FORBIDDEN');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.doctor_replace_staff_permissions(:'reception_grant_id',array['appointments.view','appointments.manage','patient.lookup','arrival.manage','queue.manage','chamber.view']::public.doctor_staff_permission[]);
select public.doctor_set_staff_status(:'reception_grant_id','TEMPORARILY_DISABLED');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_expect_error($cmd$select public.staff_create_appointment('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',now()+interval '2 hours',15,'NEW',null)$cmd$,'STAFF_APPOINTMENT_MANAGE_FORBIDDEN');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.doctor_set_staff_status(:'reception_grant_id','ACTIVE');
reset role;

-- Assistant invitation/link and bounded clinical-support paths.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
insert into public.doctor_staff_invitations(doctor_profile_id,email,role,requested_location_ids,requested_permissions,created_by)
values('10000000-0000-0000-0000-000000000001','assistant@qa.invalid','ASSISTANT',array['20000000-0000-0000-0000-000000000001']::uuid[],array['patient.lookup','appointments.view','chamber.view','intake.write','document.attach','investigation.prepare']::public.doctor_staff_permission[],'00000000-0000-0000-0000-000000000001') returning id as assistant_invitation_id \gset
reset role;
set role service_role;
select public.service_link_doctor_staff_invitation(:'assistant_invitation_id','00000000-0000-0000-0000-000000000005') as assistant_grant_id \gset
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.staff_write_intake_vitals('50000000-0000-0000-0000-000000000001',170,60,37,80,120,80,16,99);
select public.staff_attach_document_record('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','LAB_REPORT','CBC',current_date,null,'staff/a/cbc.pdf','application/pdf',100,'cbc.pdf') as assistant_document_id \gset
select public.staff_prepare_investigation('50000000-0000-0000-0000-000000000001','CBC','proposal only') as assistant_proposal_id \gset
reset role;
select public.test_assert((select vital_height_cm=170 from public.encounters where id='50000000-0000-0000-0000-000000000001'), 'Assistant vitals write succeeded');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_assert(not has_table_privilege('authenticated','public.encounter_investigations','INSERT'), 'Assistant has no final investigation insert authority');
select public.test_assert(not has_table_privilege('authenticated','public.encounter_diagnoses','INSERT'), 'Assistant has no diagnosis finalization write authority');
select public.test_assert(not has_table_privilege('authenticated','public.prescriptions','INSERT'), 'Assistant has no prescription write authority');
select public.test_assert(to_regprocedure('public.staff_finalize_investigation(uuid)') is null, 'no Staff final investigation RPC exists');
select public.test_assert((select count(*)=0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'staff%prescription%'), 'no Staff prescription RPC exists');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_expect_error(format('select public.doctor_replace_staff_permissions(%L::uuid,array[%L]::public.doctor_staff_permission[])', :'assistant_grant_id','appointments.manage'),'STAFF_PERMISSION_EXCEEDS_ROLE');
reset role;

-- Audit attribution and visibility before lifecycle removal.
select public.test_assert(exists(select 1 from public.audit_events where actor_id='00000000-0000-0000-0000-000000000003' and meta->>'doctor_profile_id'='10000000-0000-0000-0000-000000000001' and meta->>'staff_role'='RECEPTIONIST'), 'Receptionist audit actor, Doctor context, and role are separate');
select public.test_assert(exists(select 1 from public.audit_events where actor_id='00000000-0000-0000-0000-000000000005' and meta->>'doctor_profile_id'='10000000-0000-0000-0000-000000000001' and meta->>'staff_role'='ASSISTANT'), 'Assistant audit actor, Doctor context, and role remain separate');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_assert((select count(*)>0 from public.audit_events where meta->>'doctor_profile_id'='10000000-0000-0000-0000-000000000001'), 'Doctor A can inspect own Team audit');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_assert((select count(*)=0 from public.audit_events where meta->>'doctor_profile_id'='10000000-0000-0000-0000-000000000001'), 'Doctor B cannot inspect Doctor A Team audit');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_assert((select count(*)=0 from public.audit_events where meta ? 'doctor_profile_id'), 'Location Admin gains no Team audit visibility');
reset role;

-- Removal fails closed, preserves history, and cannot be toggled back.
select count(*) as staff_history_before from public.audit_events where actor_id='00000000-0000-0000-0000-000000000003' \gset
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.doctor_set_staff_status(:'reception_grant_id','REMOVED');
select public.test_expect_error(format('select public.doctor_set_staff_status(%L::uuid,%L::public.doctor_staff_status)', :'reception_grant_id','ACTIVE'),'REMOVED_STAFF_REQUIRES_NEW_ADOPTION');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claim.aal','aal2',false);
select public.test_expect_error($cmd$select public.staff_create_appointment('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',now()+interval '3 hours',15,'NEW',null)$cmd$,'STAFF_APPOINTMENT_MANAGE_FORBIDDEN');
select public.test_expect_error(format('select public.doctor_set_staff_status(%L::uuid,%L::public.doctor_staff_status)', :'reception_grant_id','ACTIVE'),'STAFF_GRANT_NOT_FOUND');
reset role;
select public.test_assert((select count(*) >= :'staff_history_before'::int from public.audit_events where actor_id='00000000-0000-0000-0000-000000000003'), 'historical Staff audit retained after removal');

-- Final privilege sanity: direct clinical writes remain unavailable to authenticated staff.
select public.test_assert(not has_table_privilege('authenticated','public.encounters','UPDATE'), 'no direct encounter update privilege');
select public.test_assert(not has_table_privilege('authenticated','public.patient_documents','INSERT'), 'document direct insert remains revoked');
select public.test_assert(not has_table_privilege('authenticated','public.appointments','UPDATE'), 'appointment direct update remains revoked');
\echo 'STAFF_MANAGEMENT_DB_QUALIFICATION_PASS'
