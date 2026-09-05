import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  assert, openLocalAdminDatabase, createDoctorFixture, createStaffFixture,
  createAuthProfile, createClinicalFlow, asAuthenticated,
  expectAuthenticatedFailure, rollbackQuietly,
} from "./p0-seta-lib.mjs";

async function withTx(fn) {
  const sql = openLocalAdminDatabase();
  try {
    await sql.unsafe("begin");
    await fn(sql);
    await sql.unsafe("rollback");
  } catch (error) {
    await rollbackQuietly(sql);
    throw error;
  }
  await sql.end({ timeout: 5 });
}

async function futureSlot(sql, timezone = "Asia/Dhaka", days = 1, hour = 10) {
  const [row] = await sql`select ((current_date + ${days}::int + make_interval(hours=>${hour}))::timestamp at time zone ${timezone}) as slot`;
  return row.slot;
}

async function finalizeFixture(sql, doctor, flow) {
  let version;
  await asAuthenticated(sql, doctor.profileId, async () => {
    await sql`select public.add_prescription_item(${flow.rxId},1,'{"display_name":"QA Medicine","dose_text":"1 tablet","duration_text":"3 days"}'::jsonb)`;
    const [rx] = await sql`select version from public.prescriptions where id=${flow.rxId}`;
    version = rx.version;
  });
  const path = `${doctor.profileId}/${flow.rxId}/signature`;
  await sql`insert into storage.objects(bucket_id,name,owner_id) values('prescription-assets',${path},${doctor.profileId}::text)`;
  let review;
  await asAuthenticated(sql, doctor.profileId, async () => {
    [review] = await sql`select public.prescription_review_bundle(${flow.rxId}) as payload`;
    const p = review.payload;
    await sql`select public.finalize_prescription(${flow.rxId},${version},${p.bundle},${p.digest},${path})`;
  });
  return { path, review: review.payload };
}

async function verifySecurity() {
  await withTx(async (sql) => {
    const tables = await sql`select c.relname,c.relrowsecurity,c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') order by c.relname`;
    assert(tables.length > 0, "no P0 public tables");
    assert(tables.every((t) => t.relrowsecurity && t.relforcerowsecurity), "every P0 table must ENABLE+FORCE RLS");
    const roles = ["anon","authenticated","service_role","dd_public_ingress"];
    for (const role of roles) {
      const [row] = await sql`select bool_or(has_table_privilege(${role},format('public.%I',c.relname),'TRUNCATE')) as any_truncate
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`;
      assert(!row.any_truncate, `${role} has TRUNCATE on a P0 table`);
    }
    const [direct] = await sql`select
      has_table_privilege('authenticated','public.encounters','INSERT,UPDATE,DELETE') or
      has_table_privilege('authenticated','public.prescriptions','INSERT,UPDATE,DELETE') or
      has_table_privilege('authenticated','public.appointments','INSERT,UPDATE,DELETE') as writable`;
    assert(!direct.writable, "authenticated gained direct clinical DML");
  });
}

async function verifyPatients() {
  await withTx(async (sql) => {
    const a = await createDoctorFixture(sql,"patients-a");
    const b = await createDoctorFixture(sql,"patients-b");
    let patient;
    await asAuthenticated(sql,a.profileId,async()=>{ [patient]=await sql`select public.create_clinical_patient('QA Patient A',${a.locationId}) id`; });
    const own = await asAuthenticated(sql,a.profileId,()=>sql`select id,owner_doctor_id,patient_number from public.clinical_patients where id=${patient.id}`);
    assert(own.length===1 && own[0].owner_doctor_id===a.professionalId,"owner cannot read own patient");
    const foreign = await asAuthenticated(sql,b.profileId,()=>sql`select id from public.clinical_patients where id=${patient.id}`);
    assert(foreign.length===0,"doctor B can read doctor A patient");
    await expectAuthenticatedFailure(sql,b.profileId,"forge patient owner",()=>sql`insert into public.clinical_patients(owner_doctor_id,patient_number,full_name) values(${a.professionalId},'FORGED','Forged')`,["42501"]);
  });
}

async function verifyDoctorIsolation() {
  await withTx(async (sql) => {
    const a=await createDoctorFixture(sql,"isolation-a"), b=await createDoctorFixture(sql,"isolation-b");
    const fa=await createClinicalFlow(sql,a,"Isolation A"), fb=await createClinicalFlow(sql,b,"Isolation B");
    await asAuthenticated(sql,a.profileId,async()=>{
      await sql`select public.update_encounter_sections(${fa.encounterId},1,'A complaint',null,null,null,null,null)`;
      await sql`select public.add_encounter_diagnosis(${fa.encounterId},2,'QA diagnosis A')`;
    });
    const probes = [
      ["clinical_patients",fa.patientId],["encounters",fa.encounterId],["prescriptions",fa.rxId],
    ];
    for (const [table,id] of probes) {
      const rows=await asAuthenticated(sql,b.profileId,()=>sql.unsafe(`select id from public.${table} where id=$1`,[id]));
      assert(rows.length===0,`doctor B can read A ${table}`);
    }
    const diagnosis=await asAuthenticated(sql,b.profileId,()=>sql`select id from public.encounter_diagnoses where encounter_id=${fa.encounterId}`);
    assert(diagnosis.length===0,"doctor B can read A diagnosis");
    await expectAuthenticatedFailure(sql,b.profileId,"cross-doctor encounter mutation",()=>sql`select public.update_encounter_sections(${fa.encounterId},2,'forged',null,null,null,null,null)`,["P0001"]);
    const policies=await sql`select tablename,policyname,coalesce(qual,'')||' '||coalesce(with_check,'') definition from pg_policies where schemaname='public'`;
    const forbidden=new Set(["encounters","encounter_diagnoses","encounter_investigations","encounter_events","prescriptions","prescription_items","prescription_events"]);
    const leaks=policies.filter(p=>forbidden.has(p.tablename) && /practice_memberships/i.test(p.definition));
    assert(leaks.length===0,`ambient location membership widened clinical reads: ${JSON.stringify(leaks)}`);
    assert(fb.patientId,"second doctor fixture missing");
  });
}

async function verifyTemplates() {
  await withTx(async (sql)=>{
    const a=await createDoctorFixture(sql,"templates-a"), b=await createDoctorFixture(sql,"templates-b");
    let templateId;
    await asAuthenticated(sql,a.profileId,async()=>{ const [r]=await sql`select public.create_prescription_template('QA Default','{"layout":"compact"}'::jsonb) id`; templateId=r.id; });
    const own=await asAuthenticated(sql,a.profileId,()=>sql`select id,name,template from public.prescription_templates where id=${templateId}`);
    assert(own.length===1 && own[0].name==='QA Default',"template create/read failed");
    const foreign=await asAuthenticated(sql,b.profileId,()=>sql`select id from public.prescription_templates where id=${templateId}`);
    assert(foreign.length===0,"doctor B can read A template");
    await expectAuthenticatedFailure(sql,b.profileId,"foreign template update",()=>sql`select public.update_prescription_template(${templateId},'Stolen','{}'::jsonb,true)`,["42501"]);
    await asAuthenticated(sql,a.profileId,()=>sql`select public.update_prescription_template(${templateId},'QA Updated','{"layout":"wide"}'::jsonb,false)`);
    const [updated]=await sql`select name,is_active from public.prescription_templates where id=${templateId}`;
    assert(updated.name==='QA Updated' && updated.is_active===false,"template update failed");
  });
}

async function verifyAppointments() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"appointments");
    const staff=await createStaffFixture(sql,"appointments-reception",doctor.locationId,"RECEPTIONIST");
    const outsider=await createAuthProfile(sql,"appointments-outsider","QA Outsider");
    const flow=await createClinicalFlow(sql,doctor,"Appointment Patient");
    const slot=await futureSlot(sql);
    let appointmentId;
    await asAuthenticated(sql,doctor.profileId,async()=>{ const [r]=await sql`select public.create_internal_appointment(${doctor.chamberId},${flow.patientId},${slot},'IN_PERSON') id`; appointmentId=r.id; });
    const [a]=await sql`select * from public.appointments where id=${appointmentId}`;
    assert(a.owner_doctor_id===doctor.professionalId && a.clinical_patient_id===flow.patientId && a.source_channel==='DOCTOR' && a.status==='SCHEDULED',"internal appointment shape incorrect");
    const staffRead=await asAuthenticated(sql,staff.profileId,()=>sql`select id from public.appointments where id=${appointmentId}`);
    assert(staffRead.length===1,"receptionist cannot read exact-location appointment");
    const outsiderRead=await asAuthenticated(sql,outsider,()=>sql`select id from public.appointments where id=${appointmentId}`);
    assert(outsiderRead.length===0,"unrelated profile can read appointment");
    await expectAuthenticatedFailure(sql,staff.profileId,"generic completion",()=>sql`select public.set_appointment_status(${appointmentId},'COMPLETED','forged')`,["42501"]);
    const slot2=await futureSlot(sql,"Asia/Dhaka",2,11); let successor;
    await asAuthenticated(sql,staff.profileId,async()=>{ const [r]=await sql`select public.reschedule_appointment(${appointmentId},${slot2}) id`; successor=r.id; });
    const [old]=await sql`select status,cancellation_reason from public.appointments where id=${appointmentId}`;
    const [next]=await sql`select status,rescheduled_from_id,source_channel from public.appointments where id=${successor}`;
    assert(old.status==='CANCELLED' && old.cancellation_reason==='RESCHEDULED',"reschedule did not close original");
    assert(next.status==='SCHEDULED' && next.rescheduled_from_id===appointmentId && next.source_channel==='RECEPTIONIST',"reschedule successor shape incorrect");
    await asAuthenticated(sql,staff.profileId,()=>sql`select public.cancel_appointment(${successor},'PATIENT_REQUEST','QA cancel')`);
    const [cancelled]=await sql`select status,cancellation_reason from public.appointments where id=${successor}`;
    assert(cancelled.status==='CANCELLED' && cancelled.cancellation_reason==='PATIENT_REQUEST',"cancel lifecycle failed");
  });
}

async function verifyQueue() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"queue");
    const staff=await createStaffFixture(sql,"queue-reception",doctor.locationId,"RECEPTIONIST");
    const flow=await createClinicalFlow(sql,doctor,"Queue Patient");
    const slot=await futureSlot(sql); let appt;
    await asAuthenticated(sql,doctor.profileId,async()=>{ const [r]=await sql`select public.create_internal_appointment(${doctor.chamberId},${flow.patientId},${slot},'IN_PERSON') id`; appt=r.id; });
    let token;
    await asAuthenticated(sql,staff.profileId,async()=>{ const [r]=await sql`select public.check_in_appointment(${appt}) token`; token=r.token; });
    assert(token===1,"first chamber/day queue token must be 1");
    const [entry]=await sql`select * from public.queue_entries where appointment_id=${appt}`;
    assert(entry.doctor_chamber_id===doctor.chamberId && entry.queue_token===1,"queue entry scope incorrect");
    await asAuthenticated(sql,staff.profileId,async()=>{
      await sql`select public.call_patient(${appt},'first call')`;
      await sql`select public.set_queue_priority(${appt},'ELDERLY','priority')`;
      await sql`select public.skip_patient(${appt},'not ready')`;
      await sql`select public.clear_queue_priority(${appt})`;
    });
    const events=await asAuthenticated(sql,staff.profileId,()=>sql`select event_type from public.queue_events where appointment_id=${appt} order by seq`);
    assert(events.map(e=>e.event_type).join(',')==='CALLED,PRIORITY_SET,SKIPPED,PRIORITY_CLEARED',"queue events incorrect");
    const [counter]=await sql`select next_token from public.queue_token_counters where doctor_chamber_id=${doctor.chamberId} and session_date=${entry.session_date}`;
    assert(counter.next_token===2,"queue counter did not advance exactly once");
  });
}

async function verifyEncounters() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"encounters"), other=await createDoctorFixture(sql,"encounters-other");
    const flow=await createClinicalFlow(sql,doctor,"Encounter Patient");
    await asAuthenticated(sql,doctor.profileId,async()=>{
      const [v2]=await sql`select public.update_encounter_sections(${flow.encounterId},1,'Fever','2 days',null,'Stable','Viral syndrome','Hydration') version`;
      assert(v2.version===2,"encounter CAS update did not increment version");
      await sql`select public.add_encounter_diagnosis(${flow.encounterId},2,'Viral fever')`;
      await sql`select public.add_encounter_investigation(${flow.encounterId},3,'CBC')`;
    });
    const [enc]=await sql`select version,chief_complaints from public.encounters where id=${flow.encounterId}`;
    assert(enc.version===4 && enc.chief_complaints==='Fever',"encounter aggregate mutation failed");
    const [counts]=await sql`select
      (select count(*)::int from public.encounter_diagnoses where encounter_id=${flow.encounterId}) diagnoses,
      (select count(*)::int from public.encounter_investigations where encounter_id=${flow.encounterId}) investigations`;
    assert(counts.diagnoses===1 && counts.investigations===1,"encounter children missing");
    await expectAuthenticatedFailure(sql,doctor.profileId,"stale encounter version",()=>sql`select public.update_encounter_sections(${flow.encounterId},1,'stale',null,null,null,null,null)`,["P0001"]);
    await expectAuthenticatedFailure(sql,other.profileId,"foreign encounter update",()=>sql`select public.update_encounter_sections(${flow.encounterId},4,'foreign',null,null,null,null,null)`,["P0001"]);
  });
}

async function verifyPrescriptions() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"prescriptions");
    const flow=await createClinicalFlow(sql,doctor,"Rx Patient");
    await asAuthenticated(sql,doctor.profileId,async()=>{
      const [item]=await sql`select public.add_prescription_item(${flow.rxId},1,'{"display_name":"Paracetamol","strength_text":"500 mg","dose_text":"1 tablet","schedule_text":"TDS","duration_text":"3 days"}'::jsonb) id`;
      assert(item.id,"prescription item insert failed");
      const [review]=await sql`select public.prescription_review_bundle(${flow.rxId}) payload`;
      assert(review.payload.bundle.items.length===1 && /^[0-9a-f]{64}$/.test(review.payload.digest),"canonical review bundle/digest invalid");
    });
    const [rx]=await sql`select status,version from public.prescriptions where id=${flow.rxId}`;
    assert(rx.status==='DRAFT' && rx.version===2,"draft/version contract failed");
    const second=await expectAuthenticatedFailure(sql,doctor.profileId,"second draft same encounter",()=>sql`select public.open_prescription(${flow.encounterId})`,["23505"]);
    assert(second,"one-draft guard absent");
  });
}

async function verifySignatureFreeze() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"signature-freeze");
    const flow=await createClinicalFlow(sql,doctor,"Signature Patient");
    const frozen=await finalizeFixture(sql,doctor,flow);
    const [rx]=await sql`select status,review_digest,signature_asset_path,review_bundle_snapshot from public.prescriptions where id=${flow.rxId}`;
    assert(rx.status==='FINALIZED' && rx.signature_asset_path===frozen.path && rx.review_digest===frozen.review.digest,"finalization did not freeze approved bundle/signature");
    const policies=await sql`select cmd,coalesce(qual,'') qual,coalesce(with_check,'') with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'p0_prescription_assets%'`;
    assert(policies.every(p=>p.cmd==='SELECT'),"prescription-assets has browser write/delete policy");
    await asAuthenticated(sql,doctor.profileId,async()=>{ await sql`update storage.objects set name=name||'-tampered' where bucket_id='prescription-assets' and name=${frozen.path}`; });
    const [stillFrozen]=await sql`select count(*)::int n from storage.objects where bucket_id='prescription-assets' and name=${frozen.path}`;
    assert(stillFrozen.n===1,"authenticated browser overwrote frozen prescription asset");
  });
}

async function verifyHandover() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"handover");
    const staff=await createStaffFixture(sql,"handover-reception",doctor.locationId,"RECEPTIONIST");
    const outsider=await createAuthProfile(sql,"handover-outsider","QA Outsider");
    const flow=await createClinicalFlow(sql,doctor,"Handover Patient");
    await finalizeFixture(sql,doctor,flow);
    let payload;
    await asAuthenticated(sql,staff.profileId,async()=>{ const [r]=await sql`select public.handover_prescription(${flow.rxId}) payload`; payload=r.payload; });
    assert(payload.id===flow.rxId && payload.bundle && payload.reviewDigest,"authorized finalized handover failed");
    await expectAuthenticatedFailure(sql,outsider,"unrelated handover",()=>sql`select public.handover_prescription(${flow.rxId})`,["42501"]);
    const [events]=await sql`select count(*)::int n from public.prescription_events where prescription_id=${flow.rxId} and event='HANDED_OVER'`;
    assert(events.n===1,"handover event missing");
  });
}

async function verifyApiAuth() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"api-auth");
    const funcs=await sql`select p.proname,oidvectortypes(p.proargtypes) args
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('create_clinical_patient','open_encounter','open_prescription','finalize_prescription','create_internal_appointment')`;
    const forbiddenOwnerParam=funcs.filter(f=>/owner|doctor_id|profile_id/i.test(f.args));
    assert(forbiddenOwnerParam.length===0,"caller-supplied owner parameter reintroduced");
    await sql.unsafe('savepoint seta_anon_auth');
    await sql`select set_config('request.jwt.claims','{"role":"anon"}',true)`;
    await sql.unsafe('set local role anon');
    let error;
    try { await sql`select public.create_clinical_patient('Anon',${doctor.locationId})`; } catch(e){ error=e; }
    await sql.unsafe('rollback to savepoint seta_anon_auth');
    await sql.unsafe('release savepoint seta_anon_auth');
    await sql.unsafe('reset role');
    await sql`select set_config('request.jwt.claims','',true)`;
    assert(error?.code==='42501' || error?.code==='42883',`anon reached clinical RPC: ${error?.code}`);
    const [anonExec]=await sql`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and has_function_privilege('anon',p.oid,'EXECUTE')`;
    assert(anonExec.n===3,"anon function surface is not exact three");
  });
}

async function verifyCorrection() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"correction");
    const flow=await createClinicalFlow(sql,doctor,"Correction Patient");
    await finalizeFixture(sql,doctor,flow);
    let correction;
    await asAuthenticated(sql,doctor.profileId,async()=>{ const [r]=await sql`select public.create_prescription_correction(${flow.rxId},'Dose corrected') id`; correction=r.id; });
    const [next]=await sql`select status,replaces_prescription_id,replacement_reason from public.prescriptions where id=${correction}`;
    assert(next.status==='DRAFT' && next.replaces_prescription_id===flow.rxId && next.replacement_reason==='Dose corrected',"correction successor linkage invalid");
    const [original]=await sql`select status,replaces_prescription_id from public.prescriptions where id=${flow.rxId}`;
    assert(original.status==='FINALIZED' && original.replaces_prescription_id===null,"original prescription was mutated by correction");
    const [items]=await sql`select count(*)::int n from public.prescription_items where prescription_id=${correction}`;
    assert(items.n===1,"correction did not copy approved medication lines");
    await expectAuthenticatedFailure(sql,doctor.profileId,"second correction",()=>sql`select public.create_prescription_correction(${flow.rxId},'Second')`,["P0001"]);
  });
}

async function verifyDoctorIdentity() {
  await withTx(async (sql)=>{
    const profileId=await createAuthProfile(sql,"doctor-identity","QA Identity Doctor");
    let professionalId;
    await asAuthenticated(sql,profileId,async()=>{ const [r]=await sql`select public.create_professional_profile('QA Identity Doctor','DOCTOR') id`; professionalId=r.id; });
    const [pp]=await sql`select profile_id,profession,display_name from public.professional_profiles where id=${professionalId}`;
    assert(pp.profile_id===profileId && pp.profession==='DOCTOR',"professional identity not bound to auth profile");
    const columns=await sql`select column_name from information_schema.columns where table_schema='public' and table_name='professional_profiles'`;
    const names=new Set(columns.map(c=>c.column_name));
    for(const forbidden of ['bmdc_registration_no','bmdc_normalized','show_bmdc_on_profile','user_id']) assert(!names.has(forbidden),`legacy doctor identity column survived: ${forbidden}`);
    const credentialCols=await sql`select column_name from information_schema.columns where table_schema='public' and table_name='professional_credentials'`;
    assert(credentialCols.some(c=>c.column_name==='registration_display'),"registration identity not separated into professional_credentials");
    await expectAuthenticatedFailure(sql,profileId,"second professional profile",()=>sql`select public.create_professional_profile('Duplicate','DOCTOR')`,["23505"]);
  });
}

async function verifyEncounterClose() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"encounter-close");
    const flow=await createClinicalFlow(sql,doctor,"Close Patient");
    await asAuthenticated(sql,doctor.profileId,()=>sql`select public.finish_consultation(${flow.encounterId},1)`);
    const [enc]=await sql`select status,version,completed_at from public.encounters where id=${flow.encounterId}`;
    assert(enc.status==='COMPLETED' && enc.version===2 && enc.completed_at,"DRAFT->COMPLETED failed");
    await expectAuthenticatedFailure(sql,doctor.profileId,"completed encounter edit",()=>sql`select public.update_encounter_sections(${flow.encounterId},2,'late edit',null,null,null,null,null)`,["P0001"]);
    await expectAuthenticatedFailure(sql,doctor.profileId,"double finish",()=>sql`select public.finish_consultation(${flow.encounterId},2)`,["P0001"]);
  });
}

async function verifyHistory() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"history-a"), other=await createDoctorFixture(sql,"history-b");
    const flow=await createClinicalFlow(sql,doctor,"History Patient");
    await asAuthenticated(sql,doctor.profileId,async()=>{
      await sql`select public.update_encounter_sections(${flow.encounterId},1,'Headache',null,null,null,null,'Review')`;
      await sql`select public.add_prescription_item(${flow.rxId},1,'{"display_name":"QA Med"}'::jsonb)`;
    });
    const ownEnc=await asAuthenticated(sql,doctor.profileId,()=>sql`select id,clinical_patient_id from public.encounters where clinical_patient_id=${flow.patientId}`);
    const ownRx=await asAuthenticated(sql,doctor.profileId,()=>sql`select id,clinical_patient_id from public.prescriptions where clinical_patient_id=${flow.patientId}`);
    assert(ownEnc.some(e=>e.id===flow.encounterId) && ownRx.some(r=>r.id===flow.rxId),"owner patient timeline incomplete");
    const foreignEnc=await asAuthenticated(sql,other.profileId,()=>sql`select id from public.encounters where clinical_patient_id=${flow.patientId}`);
    const foreignRx=await asAuthenticated(sql,other.profileId,()=>sql`select id from public.prescriptions where clinical_patient_id=${flow.patientId}`);
    assert(foreignEnc.length===0 && foreignRx.length===0,"cross-doctor history leak");
  });
}

async function verifyRxImmutability() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"rx-immutable");
    const flow=await createClinicalFlow(sql,doctor,"Immutable Patient");
    await finalizeFixture(sql,doctor,flow);
    let error=null;
    const sp='rx_direct_mutation'; await sql.unsafe(`savepoint ${sp}`);
    try { await sql`update public.prescriptions set review_digest='tampered' where id=${flow.rxId}`; } catch(e){ error=e; }
    await sql.unsafe(`rollback to savepoint ${sp}`); await sql.unsafe(`release savepoint ${sp}`);
    assert(error?.code==='P0001',`finalized prescription update was not trigger-denied: ${error?.code}`);
    error=null; await sql.unsafe('savepoint rx_item_mutation');
    try { await sql`delete from public.prescription_items where prescription_id=${flow.rxId}`; } catch(e){ error=e; }
    await sql.unsafe('rollback to savepoint rx_item_mutation'); await sql.unsafe('release savepoint rx_item_mutation');
    assert(error?.code==='P0001',`finalized item delete was not trigger-denied: ${error?.code}`);
    const medicineFks=await sql`select c.conname from pg_constraint c join pg_class t on t.oid=c.conrelid
      where t.relname='prescription_items' and c.contype='f' and pg_get_constraintdef(c.oid) ilike '%medicine%'`;
    assert(medicineFks.length===0,"prescription_items gained live medicine catalogue FK");
  });
}

async function verifyRxV4() {
  await withTx(async (sql)=>{
    const itemCols=await sql`select column_name from information_schema.columns where table_schema='public' and table_name='prescription_items'`;
    const cols=new Set(itemCols.map(c=>c.column_name));
    for(const required of ['display_name','brand_name','generic_name','strength_text','dose_text','dosage_form','route','schedule_text','duration_text','quantity_text','food_relation','is_prn','instructions','substitution_allowed','position'])
      assert(cols.has(required),`prescription_items missing Stage-12 field ${required}`);
    const rxCols=await sql`select column_name from information_schema.columns where table_schema='public' and table_name='prescriptions'`;
    const rx=new Set(rxCols.map(c=>c.column_name));
    for(const required of ['review_bundle_snapshot','review_digest','signature_asset_path','replaces_prescription_id','replacement_reason','snapshot_schema_version'])
      assert(rx.has(required),`prescriptions missing Stage-12 field ${required}`);
    const [draftIndex]=await sql`select indexdef from pg_indexes where schemaname='public' and tablename='prescriptions' and indexname='prescriptions_one_draft'`;
    assert(/where.*status.*draft/i.test(draftIndex?.indexdef??''),"one-draft partial index missing");
    const [replacementIndex]=await sql`select indexdef from pg_indexes where schemaname='public' and tablename='prescriptions' and indexname='prescriptions_one_replacement'`;
    assert(/replaces_prescription_id/i.test(replacementIndex?.indexdef??''),"one-replacement guard missing");
  });
}

async function verifyProfessionalProfile() {
  await withTx(async (sql)=>{
    const doctor=await createDoctorFixture(sql,"professional-profile");
    await asAuthenticated(sql,doctor.profileId,()=>sql`select public.update_professional_profile('Dr QA Updated','Consultant','MBBS','QA bio','PUBLIC')`);
    const [pp]=await sql`select display_name,designation,qualification,bio,profile_visibility from public.professional_profiles where id=${doctor.professionalId}`;
    assert(pp.display_name==='Dr QA Updated' && pp.profile_visibility==='PUBLIC' && pp.qualification==='MBBS',"professional profile update failed");
    const [ch]=await sql`select doctor_id,practice_location_id from public.doctor_chambers where id=${doctor.chamberId}`;
    assert(ch.doctor_id===doctor.professionalId && ch.practice_location_id===doctor.locationId,"doctor chamber relationship invalid");
    const [membership]=await sql`select role,status from public.practice_memberships where profile_id=${doctor.profileId} and practice_location_id=${doctor.locationId}`;
    assert(membership.role==='DOCTOR' && membership.status==='ACTIVE',"doctor location membership missing");
  });
}

async function verifyQaProvenance() {
  await withTx(async (sql)=>{
    const id=await createAuthProfile(sql,"qa-provenance","QA Provenance");
    const [user]=await sql`select email from auth.users where id=${id}`;
    assert(user.email.endsWith('@qa.invalid'),"synthetic fixture email must use @qa.invalid");
    const files=await fs.readdir('scripts');
    const p0Files=files.filter(f=>f.startsWith('verify-')||f.startsWith('p0-'));
    for(const file of p0Files){
      const text=await fs.readFile(`scripts/${file}`,'utf8');
      assert(!/[A-Za-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo)\.com/i.test(text),`${file}: personal email literal used in Track-A verifier`);
      assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text),`${file}: static user-like UUID literal used in Track-A verifier`);
    }
  });
}

async function verifyQaCleanup() {
  const sql=openLocalAdminDatabase();
  try {
    const [qa]=await sql`select count(*)::int n from auth.users where email like '%@qa.invalid'`;
    assert(qa.n===0,`QA fixtures leaked before cleanup gate: ${qa.n} auth users`);
    const [orphans]=await sql`select count(*)::int n from public.profiles p left join auth.users u on u.id=p.id where u.id is null`;
    assert(orphans.n===0,`orphan profiles remain: ${orphans.n}`);
    const [contacts]=await sql`select count(*)::int n from public.public_booking_contacts where contact_name ilike 'QA %'`;
    assert(contacts.n===0,`public booking QA contacts remain: ${contacts.n}`);
  } finally { await sql.end({timeout:5}); }
}

async function verifyMigrations() {
  const manifest=await fs.readFile('db/manifest.toml','utf8');
  const steps=[...manifest.matchAll(/\[\[step\]\][\s\S]*?file = "([^"]+)"\nsha256 = "([0-9a-f]{64})"/g)];
  assert(steps.length===6,"P0 manifest must have exactly six deployment steps");
  const kinds=[...manifest.matchAll(/kind = "([^"]+)"/g)].map(m=>m[1]);
  assert(kinds.join(',')==='schema,functions,policies,grants,storage,seed',"P0 manifest order drifted");
  for(const [,file,expected] of steps){
    const bytes=await fs.readFile(file); const actual=crypto.createHash('sha256').update(bytes).digest('hex');
    assert(actual===expected,`manifest hash mismatch: ${file}`);
  }
  let linked=false;
  try { const ref=(await fs.readFile('supabase/.temp/project-ref','utf8')).trim(); linked=Boolean(ref); } catch {}
  assert(!linked,"Track-A Supabase directory is remotely linked");
  const runner=await fs.readFile('scripts/p0-target.mjs','utf8');
  assert(runner.includes('DD_V2_LOCAL_DATABASE_URL') && runner.includes('127.0.0.1'),"local-only P0 target guard missing");
}

const checks={
  security:verifySecurity,
  patients:verifyPatients,
  'doctor-isolation':verifyDoctorIsolation,
  templates:verifyTemplates,
  appointments:verifyAppointments,
  queue:verifyQueue,
  encounters:verifyEncounters,
  prescriptions:verifyPrescriptions,
  'signature-freeze':verifySignatureFreeze,
  handover:verifyHandover,
  'api-auth':verifyApiAuth,
  correction:verifyCorrection,
  'doctor-identity':verifyDoctorIdentity,
  'encounter-close':verifyEncounterClose,
  history:verifyHistory,
  'rx-immutability':verifyRxImmutability,
  'rx-v4':verifyRxV4,
  'professional-profile':verifyProfessionalProfile,
  'qa-provenance':verifyQaProvenance,
  'qa-cleanup':verifyQaCleanup,
  migrations:verifyMigrations,
};

export async function runSetA(name){
  const fn=checks[name];
  assert(fn,`unknown P0 Set-A verifier: ${name}`);
  await fn();
  console.log(`verify-${name}: PASS (V2 P0)`);
}

export const P0_SET_A_NAMES=Object.freeze(Object.keys(checks));
