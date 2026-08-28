import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set");
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
  try { return await fn(); } finally { await tx`reset role`; }
}

const uidA = crypto.randomUUID();
const uidB = crypto.randomUUID();
const uidR = crypto.randomUUID();
const uidM = crypto.randomUUID();

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [[uidA,"Dr A"],[uidB,"Dr B"],[uidR,"Reception"],[uidM,"Admin"]]) {
      await tx`insert into auth.users (id,email) values (${uid},${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id,full_name) values (${uid},${name})`;
    }
    const [docA] = await tx`insert into public.doctor_profiles
      (user_id,patient_number_prefix,bmdc_registration_no)
      values (${uidA},'LA',${"QL" + crypto.randomBytes(3).toString("hex")}) returning id`;
    await tx`insert into public.doctor_profiles
      (user_id,patient_number_prefix,bmdc_registration_no)
      values (${uidB},'LB',${"QM" + crypto.randomBytes(3).toString("hex")})`;
    const [loc] = await tx`insert into public.practice_locations(name,type,created_by)
      values ('QA Link Isolation','HOSPITAL',${uidA}) returning id`;
    await tx`insert into public.practice_location_members(practice_location_id,user_id,role,status)
      values (${loc.id},${uidA},'DOCTOR','ACTIVE'),(${loc.id},${uidB},'DOCTOR','ACTIVE'),
             (${loc.id},${uidR},'RECEPTIONIST','ACTIVE'),(${loc.id},${uidM},'LOCATION_ADMIN','ACTIVE')`;
    const [pat] = await tx`insert into public.patients
      (owner_doctor_id,patient_number,full_name,name_normalized,sex,created_by)
      values (${docA.id},'LA-000001','Private Patient','private patient','FEMALE',${uidA}) returning id`;
    await tx`insert into public.patient_location_links(patient_id,practice_location_id) values (${pat.id},${loc.id})`;
    await tx`insert into public.patient_contacts(patient_id,type,name,phone)
      values (${pat.id},'EMERGENCY','Next of kin','+8801700000000')`;

    const drB = await as(tx, uidB, async () => ({
      patient: (await tx`select id from public.patients where id=${pat.id}`).length,
      link: (await tx`select patient_id from public.patient_location_links where patient_id=${pat.id}`).length,
      contact: (await tx`select id from public.patient_contacts where patient_id=${pat.id}`).length,
      contactInsertPredicate: (await tx`select public.can_access_patient_as(${pat.id},array['RECEPTIONIST']::public.location_role[]) as ok`)[0].ok,
      linkPredicate: (await tx`select public.has_location_role(${loc.id},array['RECEPTIONIST','LOCATION_ADMIN']::public.location_role[]) as ok`)[0].ok,
    }));
    check(drB.patient === 0, "Dr B cannot read Dr A patient", `${drB.patient} row(s)`);
    check(drB.contact === 0, "Dr B cannot read Dr A contacts", `${drB.contact} row(s)`);
    check(drB.link === 0, "Dr B cannot enumerate Dr A patient/location link", `${drB.link} row(s)`);
    check(drB.contactInsertPredicate === false, "Dr B cannot satisfy contact INSERT authority");
    check(drB.linkPredicate === false, "Dr B cannot satisfy operational link authority");

    const rec = await as(tx, uidR, async () => ({
      patient: (await tx`select id from public.patients where id=${pat.id}`).length,
      link: (await tx`select patient_id from public.patient_location_links where patient_id=${pat.id}`).length,
      contact: (await tx`select id from public.patient_contacts where patient_id=${pat.id}`).length,
    }));
    check(rec.patient === 1 && rec.link === 1 && rec.contact === 1, "Reception keeps operational access");

    const adm = await as(tx, uidM, async () => ({
      patient: (await tx`select id from public.patients where id=${pat.id}`).length,
      link: (await tx`select patient_id from public.patient_location_links where patient_id=${pat.id}`).length,
      contact: (await tx`select id from public.patient_contacts where patient_id=${pat.id}`).length,
    }));
    check(adm.patient === 1 && adm.link === 1 && adm.contact === 1, "Location admin keeps existing operational access");

    const badDoctor = await tx`
      select tablename,policyname from pg_policies
      where schemaname='public'
        and tablename like 'patient%'
        and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%can_access_patient_as%'
        and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%DOCTOR%'`;
    check(badDoctor.length === 0, "No patient allowlist names DOCTOR", badDoctor.map(r=>`${r.tablename}.${r.policyname}`).join(', ') || 'none');

    const looseLinks = await tx`
      select policyname from pg_policies where schemaname='public'
        and tablename='patient_location_links' and cmd='SELECT'
        and coalesce(qual,'') like '%is_active_member%'`;
    check(looseLinks.length === 0, "patient_location_links no longer authorizes any active member");

    throw new Error('ROLLBACK');
  });
} catch (e) {
  if (e.message !== 'ROLLBACK') failures.push(`aborted: ${e.message}`);
}

const [left] = await sql`select count(*)::int as n from auth.users where id in (${uidA},${uidB},${uidR},${uidM})`;
check(left.n === 0, "Fixture rolled back completely");
await sql.end();
if (failures.length) {
  console.error(`\n${failures.length} FAILED`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("\nCross-doctor link isolation: all checks passed.\n");
