import crypto from "node:crypto";
import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";

export { assert, openLocalAdminDatabase };
export const uuid = () => crypto.randomUUID();

export function qaEmail(label) {
  return `dd.p0.${label}.${crypto.randomUUID()}@qa.invalid`;
}

export async function createAuthProfile(sql, label, fullName = "QA User") {
  const id = uuid();
  await sql`insert into auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
    raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,
    email_change_token_new,email_change_token_current,phone_change,phone_change_token,reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000',${id},'authenticated','authenticated',${qaEmail(label)},'',
    now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,'','','','','','','',''
  )`;
  await sql`insert into public.profiles(id,full_name,onboarded_at) values(${id},${fullName},now())`;
  return id;
}

export async function createDoctorFixture(sql, label = "seta", options = {}) {
  const status = options.status ?? "VERIFIED";
  const profileId = await createAuthProfile(sql, label, options.name ?? "QA Doctor");
  const regulatorId = uuid();
  await sql`insert into public.regulators(id,country_code,authority_code,authority_name)
    values(${regulatorId},${options.country ?? "BD"},${`QA-${label}-${regulatorId.slice(0,8)}`},${`QA ${label} Regulator`})`;
  await sql`insert into public.regulator_professions(regulator_id,profession) values(${regulatorId},'DOCTOR')`;
  const [professional] = await sql`insert into public.professional_profiles(profile_id,profession,display_name,profile_visibility)
    values(${profileId},'DOCTOR',${options.name ?? "QA Doctor"},${options.visibility ?? "PRIVATE"}) returning id`;
  const [credential] = await sql`insert into public.professional_credentials(
    professional_profile_id,regulator_id,country_code,profession,registration_display,verification_status,verified_at,expires_at,source_kind
  ) values(${professional.id},${regulatorId},${options.country ?? "BD"},'DOCTOR',${`QA-${professional.id.slice(0,8)}`},${status},
    ${status === "VERIFIED" ? sql`clock_timestamp()` : null},${options.expiresAt ?? null},'REGULATOR_IMPORT') returning id`;
  const [location] = await sql`insert into public.practice_locations(
    name,location_type,country_code,timezone,is_active,is_bookable,created_by
  ) values(${`QA ${label} Chamber`},'PERSONAL_CHAMBER',${options.country ?? "BD"},${options.timezone ?? "Asia/Dhaka"},true,true,${profileId}) returning id`;
  await sql`insert into public.practice_memberships(practice_location_id,profile_id,role,status,joined_at)
    values(${location.id},${profileId},'DOCTOR','ACTIVE',now())`;
  const [chamber] = await sql`insert into public.doctor_chambers(doctor_id,practice_location_id) values(${professional.id},${location.id}) returning id`;
  await sql`insert into public.doctor_chamber_hours(doctor_chamber_id,weekday,start_time,end_time)
    select ${chamber.id},d,'00:00'::time,'23:59'::time from generate_series(0,6) d`;
  return { profileId, professionalId: professional.id, credentialId: credential.id, regulatorId, locationId: location.id, chamberId: chamber.id };
}

export async function createStaffFixture(sql, label, locationId, role = "RECEPTIONIST") {
  const profileId = await createAuthProfile(sql, label, `QA ${role}`);
  await sql`insert into public.practice_memberships(practice_location_id,profile_id,role,status,joined_at)
    values(${locationId},${profileId},${role},'ACTIVE',now())`;
  return { profileId };
}

let spCounter = 0;

export async function asAuthenticated(sql, profileId, action) {
  const sp = `seta_role_${++spCounter}`;
  await sql.unsafe(`savepoint ${sp}`);
  try {
    await sql`select set_config('request.jwt.claims',${JSON.stringify({ sub: profileId, role: "authenticated" })},true)`;
    await sql.unsafe("set local role authenticated");
    const value = await action();
    await sql.unsafe("reset role");
    await sql`select set_config('request.jwt.claims','',true)`;
    await sql.unsafe(`release savepoint ${sp}`);
    return value;
  } catch (error) {
    try { await sql.unsafe(`rollback to savepoint ${sp}`); await sql.unsafe(`release savepoint ${sp}`); await sql.unsafe("reset role"); await sql`select set_config('request.jwt.claims','',true)`; } catch {}
    throw error;
  }
}
export async function expectAuthenticatedFailure(sql, profileId, label, action, codes = []) {
  const sp = `seta_fail_${++spCounter}`;
  await sql.unsafe(`savepoint ${sp}`);
  let error = null;
  try {
    await sql`select set_config('request.jwt.claims',${JSON.stringify({ sub: profileId, role: "authenticated" })},true)`;
    await sql.unsafe("set local role authenticated");
    await action();
  } catch (e) { error = e; }
  await sql.unsafe(`rollback to savepoint ${sp}`);
  await sql.unsafe(`release savepoint ${sp}`);
  await sql.unsafe("reset role");
  await sql`select set_config('request.jwt.claims','',true)`;
  assert(error, `${label}: unexpectedly succeeded`);
  if (codes.length) assert(codes.includes(error.code), `${label}: SQLSTATE ${error.code}: ${error.message}`);
  return error;
}

export async function createClinicalFlow(sql, doctor, label = "Patient") {
  let patientId, encounterId, rxId;
  await asAuthenticated(sql, doctor.profileId, async () => {
    const [patient] = await sql`select public.create_clinical_patient(${`QA ${label}`},${doctor.locationId}) as id`;
    patientId = patient.id;
    const [encounter] = await sql`select public.open_encounter(${patientId},${doctor.locationId}) as id`;
    encounterId = encounter.id;
    const [rx] = await sql`select public.open_prescription(${encounterId}) as id`;
    rxId = rx.id;
  });
  return { patientId, encounterId, rxId };
}

export async function rollbackQuietly(sql) {
  try { await sql.unsafe("rollback"); } catch {}
  try { await sql.end({ timeout: 5 }); } catch {}
}
