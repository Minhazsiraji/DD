import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

export const PRODUCT_SHA = "bd4e86e58cc63ab6868c5959eccf3d5def6b7a36";
export const PRODUCT_BASE = "1708edcdc10a8f6ed1f87ee81e6ebe21d27aa99d";
export const PRODUCT_DIR = process.env.M3_PRODUCT_DIR ?? new URL("../../product", import.meta.url).pathname;
export const DB_URL = process.env.M3_LOCAL_DATABASE_URL;
if (!DB_URL) throw new Error("M3_LOCAL_DATABASE_URL is required");
const parsed = new URL(DB_URL);
if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(parsed.hostname)) {
  throw new Error(`Refusing non-loopback M3 proof database: ${parsed.hostname}`);
}

export const sql = postgres(DB_URL, { max: 20, prepare: false, onnotice: () => {} });
export const uuid = () => randomUUID();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function ok(condition, message) {
  assert.ok(condition, message);
}

export async function expectError(promise, pattern, label = "expected failure") {
  try {
    await promise;
    assert.fail(`${label}: unexpectedly succeeded`);
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error;
    const text = String(error?.message ?? error);
    assert.match(text, pattern instanceof RegExp ? pattern : new RegExp(pattern), `${label}: ${text}`);
    return error;
  }
}

export async function asAuthenticated(profileId, action) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: profileId, role: "authenticated" })}, true)`;
    await tx.unsafe("set local role authenticated");
    return action(tx);
  });
}

export async function asAuthenticatedWithoutUser(action) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', '{}', true)`;
    await tx.unsafe("set local role authenticated");
    return action(tx);
  });
}

export async function asRole(role, action, claims = {}) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    await tx.unsafe(`set local role ${role}`);
    return action(tx);
  });
}

async function authInstanceId() {
  try {
    const rows = await sql`select id from auth.instances limit 1`;
    if (rows[0]?.id) return rows[0].id;
  } catch {}
  return "00000000-0000-0000-0000-000000000000";
}

export async function createProfile(label, fullName = `QA ${label}`) {
  const id = uuid();
  const instanceId = await authInstanceId();
  const email = `dd.m3.${label}.${id.slice(0, 8)}@qa.invalid`;
  await sql`insert into auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
    raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,
    email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token
  ) values (
    ${instanceId},${id},'authenticated','authenticated',${email},'',now(),now(),now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,'','','','','','','',''
  )`;
  await sql`insert into public.profiles(id,full_name,onboarded_at) values(${id},${fullName},now())`;
  return { id, email, fullName };
}

export async function createDoctor(label, fullName = `Dr QA ${label}`) {
  const profile = await createProfile(label, fullName);
  const [doctor] = await sql`insert into public.doctor_profiles(
    user_id, qualification, specialization, designation, bmdc_registration_no, patient_number_prefix
  ) values (${profile.id}, 'MBBS', 'General Medicine', 'Consultant', ${`QA-${uuid().slice(0, 8)}`}, 'QA') returning id`;
  return { profileId: profile.id, doctorId: doctor.id, fullName };
}

export async function createLocation(createdBy, label = "Chamber") {
  const [row] = await sql`insert into public.practice_locations(
    name,type,address,district,phone,timezone,created_by,is_active
  ) values (${`QA ${label}`},'PERSONAL_CHAMBER','QA address','Dhaka','01000000000','Asia/Dhaka',${createdBy},true)
  returning id`;
  return row.id;
}

export async function addMembership(profileId, locationId, role = "DOCTOR", status = "ACTIVE") {
  const [row] = await sql`insert into public.practice_location_members(
    practice_location_id,user_id,role,status,joined_at
  ) values (${locationId},${profileId},${role}::public.location_role,${status}::public.member_status,now())
  returning id`;
  return row.id;
}

export async function createDoctorAt(label, { secondLocation = false } = {}) {
  const doctor = await createDoctor(label);
  const locationId = await createLocation(doctor.profileId, `${label} A`);
  const doctorMembershipId = await addMembership(doctor.profileId, locationId, "DOCTOR");
  const adminMembershipId = await addMembership(doctor.profileId, locationId, "LOCATION_ADMIN");
  let secondLocationId = null;
  let secondDoctorMembershipId = null;
  if (secondLocation) {
    secondLocationId = await createLocation(doctor.profileId, `${label} B`);
    secondDoctorMembershipId = await addMembership(doctor.profileId, secondLocationId, "DOCTOR");
  }
  return { ...doctor, locationId, doctorMembershipId, adminMembershipId, secondLocationId, secondDoctorMembershipId };
}

export async function createStaff(label, locationId, role = "RECEPTIONIST") {
  const profile = await createProfile(label, `QA ${role} ${label}`);
  const membershipId = await addMembership(profile.id, locationId, role);
  return { profileId: profile.id, membershipId, fullName: profile.fullName, role };
}

export async function createPatient(doctor, label = "Patient", locations = [doctor.locationId]) {
  const id = uuid();
  const number = `QA-${id.slice(0, 8)}`;
  await sql`insert into public.patients(
    id,owner_doctor_id,patient_number,full_name,name_normalized,sex,blood_group,created_by
  ) values (${id},${doctor.doctorId},${number},${`QA ${label}`},${`qa ${label}`},'UNKNOWN','UNKNOWN',${doctor.profileId})`;
  for (const locationId of locations.filter(Boolean)) {
    await sql`insert into public.patient_location_links(patient_id,practice_location_id)
      values(${id},${locationId}) on conflict do nothing`;
  }
  return id;
}

export async function createEncounter(doctor, patientId, locationId = doctor.locationId, status = "COMPLETED") {
  const [row] = await sql`insert into public.encounters(
    owner_doctor_id,patient_id,practice_location_id,status,created_by,started_at,completed_at
  ) values (
    ${doctor.doctorId},${patientId},${locationId},${status}::public.encounter_status,${doctor.profileId},
    clock_timestamp() - interval '1 hour',
    case when ${status}='COMPLETED' then clock_timestamp() else null end
  ) returning id`;
  return row.id;
}

export async function createDraftPrescription(doctor, patientId, {
  locationId = doctor.locationId,
  encounterId = null,
  replacesPrescriptionId = null,
  replacementReason = null,
  items = [],
  version = 1,
} = {}) {
  const encId = encounterId ?? await createEncounter(doctor, patientId, locationId, "COMPLETED");
  const [row] = await sql`insert into public.prescriptions(
    encounter_id,owner_doctor_id,patient_id,practice_location_id,status,version,
    replaces_prescription_id,replacement_reason,created_by
  ) values (
    ${encId},${doctor.doctorId},${patientId},${locationId},'DRAFT',${version},
    ${replacesPrescriptionId},${replacementReason},${doctor.profileId}
  ) returning id,version`;
  const inserted = await addPrescriptionItems(row.id, items);
  return { id: row.id, encounterId: encId, version: row.version, items: inserted };
}

export async function addPrescriptionItems(prescriptionId, items) {
  const result = [];
  let fallback = 1;
  for (const item of items) {
    const [row] = await sql`insert into public.prescription_items(
      prescription_id,display_name,brand_name,generic_name,strength_text,dose_text,
      dosage_form,route,schedule_text,duration_text,quantity_text,food_relation,
      is_prn,instructions,substitution_allowed,position
    ) values (
      ${prescriptionId},${item.displayName},${item.brandName ?? null},${item.genericName ?? null},
      ${item.strengthText ?? null},${item.doseText ?? null},${item.dosageForm ?? null},${item.route ?? null},
      ${item.scheduleText ?? null},${item.durationText ?? null},${item.quantityText ?? null},${item.foodRelation ?? null},
      ${item.isPrn ?? false},${item.instructions ?? null},${item.substitutionAllowed ?? true},${item.position ?? fallback}
    ) returning id,position,display_name`;
    result.push(row);
    fallback += 1;
  }
  return result;
}

export async function prescriptionItemProjection(prescriptionId) {
  const [row] = await sql`
    select coalesce(jsonb_agg(to_jsonb(i) order by i.position), '[]'::jsonb) as items
    from (
      select position, display_name, brand_name, generic_name, strength_text,
             dose_text, dosage_form, route, schedule_text, duration_text,
             quantity_text, food_relation, is_prn, instructions, substitution_allowed
      from public.prescription_items
      where prescription_id=${prescriptionId}
    ) i`;
  return row.items;
}

export async function finalizeFixture(prescriptionId, doctor, finalizedAt = new Date(Date.now() - 60_000)) {
  const items = await prescriptionItemProjection(prescriptionId);
  const bundle = { schemaVersion: 4, clinicalDate: "2026-09-07", items };
  await sql`update public.prescriptions set
    status='FINALIZED',
    finalized_at=${finalizedAt},
    finalized_by=${doctor.profileId},
    snapshot_schema_version=4,
    review_bundle_snapshot=${sql.json(bundle)},
    doctor_snapshot='{}'::jsonb,
    location_snapshot='{}'::jsonb,
    patient_snapshot='{}'::jsonb,
    template_snapshot='{}'::jsonb,
    items_snapshot=${sql.json(items)},
    review_digest=${`qa-digest-${prescriptionId}`},
    updated_at=clock_timestamp()
  where id=${prescriptionId}`;
  return { items, bundle };
}

export async function createFinalizedPrescription(doctor, patientId, {
  locationId = doctor.locationId,
  encounterId = null,
  items = [{ displayName: "QA Medicine", position: 1 }],
  finalizedAt = new Date(Date.now() - 60_000),
  replacesPrescriptionId = null,
  replacementReason = null,
  version = 1,
} = {}) {
  const draft = await createDraftPrescription(doctor, patientId, {
    locationId, encounterId, replacesPrescriptionId, replacementReason, items, version,
  });
  await finalizeFixture(draft.id, doctor, finalizedAt);
  return draft;
}

export async function getPrescriptionSnapshot(prescriptionId) {
  const [rx] = await sql`select * from public.prescriptions where id=${prescriptionId}`;
  const [items] = await sql`select coalesce(jsonb_agg(to_jsonb(i) order by i.position),'[]'::jsonb) as rows
    from public.prescription_items i where prescription_id=${prescriptionId}`;
  return { rx, items: items.rows };
}

export async function countItems(prescriptionId) {
  const [row] = await sql`select count(*)::integer as count from public.prescription_items where prescription_id=${prescriptionId}`;
  return row.count;
}

export async function closeSql() {
  await sql.end({ timeout: 5 });
}
