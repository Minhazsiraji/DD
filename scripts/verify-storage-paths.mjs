import crypto from "node:crypto";
import { assert, openLocalAdminDatabase, createDoctorFixture, createClinicalFlow, asAuthenticated, expectAuthenticatedFailure, rollbackQuietly } from "./p0-seta-lib.mjs";

const sql=openLocalAdminDatabase();
const p0Buckets=["doctor-profile-photos","doctor-signatures","prescription-assets"];
const laterBuckets=["clinical-documents","personal-health-documents","community-media","verification-evidence"];

try {
  await sql.unsafe("begin");
  const buckets=await sql`select id,public from storage.buckets where id = any(${[...p0Buckets,...laterBuckets]}) order by id`;
  const present=new Set(buckets.map(b=>b.id));
  assert(p0Buckets.every(b=>present.has(b)),`missing P0 bucket: ${JSON.stringify(buckets)}`);
  assert(laterBuckets.every(b=>!present.has(b)),`later-phase bucket appeared in P0: ${JSON.stringify([...present].filter(x=>laterBuckets.includes(x)))}`);
  assert(buckets.every(b=>b.public===false),"P0 storage bucket became public");

  const doctor=await createDoctorFixture(sql,"storage-paths");
  let photoPath,signaturePath;
  await asAuthenticated(sql,doctor.profileId,async()=>{
    const [photo]=await sql`select public.prepare_doctor_asset('PHOTO') path`; photoPath=photo.path;
    await sql`insert into storage.objects(bucket_id,name,owner_id) values('doctor-profile-photos',${photoPath},${doctor.profileId}::text)`;
    const own=await sql`select id from storage.objects where bucket_id='doctor-profile-photos' and name=${photoPath}`;
    assert(own.length===1,"prepared profile-photo positive path denied");
    const [signature]=await sql`select public.prepare_doctor_asset('SIGNATURE') path`; signaturePath=signature.path;
    await sql`insert into storage.objects(bucket_id,name,owner_id) values('doctor-signatures',${signaturePath},${doctor.profileId}::text)`;
  });

  await expectAuthenticatedFailure(sql,doctor.profileId,"forged doctor asset path",()=>sql`
    insert into storage.objects(bucket_id,name,owner_id)
    values('doctor-signatures',${doctor.profileId+'/'+crypto.randomUUID()},${doctor.profileId}::text)
  `,["42501"]);

  const flow=await createClinicalFlow(sql,doctor,"Storage Patient");
  let frozenPath,review,version;
  await asAuthenticated(sql,doctor.profileId,async()=>{
    const [p]=await sql`select public.prepare_prescription_signature_asset(${flow.rxId}) path`; frozenPath=p.path;
    await sql`select public.add_prescription_item(${flow.rxId},1,'{"display_name":"QA Medicine"}'::jsonb)`;
    const [r]=await sql`select version from public.prescriptions where id=${flow.rxId}`; version=r.version;
    const [rv]=await sql`select public.prescription_review_bundle(${flow.rxId}) payload`; review=rv.payload;
  });
  await expectAuthenticatedFailure(sql,doctor.profileId,"browser frozen asset insert",()=>sql`
    insert into storage.objects(bucket_id,name,owner_id) values('prescription-assets',${frozenPath},${doctor.profileId}::text)
  `,["42501"]);
  await sql`insert into storage.objects(bucket_id,name,owner_id) values('prescription-assets',${frozenPath},${doctor.profileId}::text)`;
  await asAuthenticated(sql,doctor.profileId,async()=>{
    await sql`select public.finalize_prescription(${flow.rxId},${version},${review.bundle},${review.digest},${frozenPath})`;
    const visible=await sql`select id from storage.objects where bucket_id='prescription-assets' and name=${frozenPath}`;
    assert(visible.length===1,"authorized finalized frozen asset read denied");
    const forged=await sql`select id from storage.objects where bucket_id='prescription-assets' and name=${frozenPath+'-other'}`;
    assert(forged.length===0,"guessed frozen path became authority");
  });

  const policies=await sql`select policyname,cmd,roles,coalesce(qual,'') qual,coalesce(with_check,'') with_check
    from pg_policies where schemaname='storage' and tablename='objects' order by policyname`;
  const frozenWrites=policies.filter(p=>/prescription/i.test(p.policyname) && ['INSERT','UPDATE','DELETE','ALL'].includes(p.cmd));
  assert(frozenWrites.length===0,"prescription-assets gained browser mutation policy");
  const unsafeParsing=policies.filter(p=>/split_part|path_tokens|owner_id|auth\.uid/i.test(`${p.qual} ${p.with_check}`));
  assert(unsafeParsing.length===0,`storage path/owner metadata became direct authority: ${JSON.stringify(unsafeParsing)}`);
  const doctorPolicy=policies.filter(p=>/p0_doctor_assets/.test(p.policyname));
  assert(doctorPolicy.every(p=>/may_write_doctor_asset/.test(`${p.qual} ${p.with_check}`)),"doctor asset policy does not resolve path to owned row");
  const frozenRead=policies.find(p=>p.policyname==='p0_prescription_assets_read');
  assert(frozenRead && /may_read_prescription_asset/.test(frozenRead.qual),"frozen asset read does not re-evaluate prescription ownership/handover");
  console.log("verify-storage-paths: PASS (3 P0-only private buckets + owned doctor positive path + server-only frozen write + no overwrite/delete + row-resolved reads)");
  await sql.unsafe("rollback");
} catch(error){
  await rollbackQuietly(sql);
  throw error;
} finally {
  try { await sql.end({timeout:5}); } catch {}
}
