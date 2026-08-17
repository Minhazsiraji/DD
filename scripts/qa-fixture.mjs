/**
 * Throwaway QA accounts for browser verification. DEV ONLY, FAKE DATA ONLY.
 *
 *   npm run qa:create    # doctor + second doctor + receptionist, all signed-in-able
 *   npm run qa:destroy   # removes every account this script created
 *   npm run qa:status    # what currently exists
 *
 * Why this exists: several classes of bug in this project only appear when a
 * real session drives the real UI — a Base UI component that crashes on mount, a
 * layout that reads correctly but renders wrong, a fail-closed branch that never
 * fires. Those need a signed-in browser, and hand-building one every time is
 * where the mistakes creep in.
 *
 * Accounts are created directly in auth.users because no service-role key is
 * configured (by the owner's explicit choice). GoTrue rejects a password login
 * when its token columns are NULL, so they are seeded to '' — that is a real
 * GoTrue requirement, not a workaround.
 *
 * Every address, name and number here is invented. `@qa.invalid` is reserved by
 * RFC 2606 and can never be a real mailbox.
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

/** Every QA account shares this suffix, which is how destroy finds them. */
const QA_DOMAIN = "@qa.invalid";
const PASSWORD = "QaFixture12345";

const PEOPLE = {
  doctor: { email: `qa.doctor${QA_DOMAIN}`, name: "Dr Ayesha Rahman" },
  other: { email: `qa.other.doctor${QA_DOMAIN}`, name: "Dr Kamal Uddin" },
  reception: { email: `qa.reception${QA_DOMAIN}`, name: "Nusrat Jahan" },
};

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const mode = process.argv[2] ?? "status";

const [{ nspname: ext }] = await sql`
  select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'crypt' limit 1`;

async function createUser(tx, email, fullName) {
  const id = crypto.randomUUID();

  await tx.unsafe(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change, email_change_token_new,
       email_change_token_current, phone_change, phone_change_token,
       reauthentication_token
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, ${ext}.crypt($3, ${ext}.gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       '', '', '', '', '', '', '', ''
     )`,
    [id, email, PASSWORD],
  );

  await tx`
    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), ${id}, ${id},
            ${sql.json({ sub: id, email, email_verified: true })}, 'email',
            now(), now(), now())`;

  await tx`insert into public.profiles (id, full_name, onboarded_at)
           values (${id}, ${fullName}, now())`;

  return id;
}

if (mode === "destroy") {
  const rows = await sql`select id, email from auth.users where email like ${"%" + QA_DOMAIN}`;
  const ids = rows.map((r) => r.id);

  /**
   * Order matters, and that is the point.
   *
   * Appointments RESTRICT on their doctor and patient, and appointment_events
   * RESTRICT on the appointment, so clinical history cannot be swept away by
   * deleting a person. Cleanup has to unwind it deliberately — if this ever
   * stops being necessary, the durability guarantee has been weakened.
   */
  if (ids.length > 0) {
    const locations = await sql`
      select id from public.practice_locations where created_by in ${sql(ids)}`;
    const locationIds = locations.map((l) => l.id);

    if (locationIds.length > 0) {
      /**
       * Encounters first of all. They RESTRICT on the appointment, the patient
       * and the location, and their own children RESTRICT on them — a
       * consultation cannot be erased as a side effect of tidying up, which is
       * the whole point of Stage 6A's foreign keys.
       */
      /**
       * Prescriptions before encounters. `prescriptions.encounter_id`
       * RESTRICTS, so an encounter that was prescribed from cannot be tidied
       * away until its prescription is — and the replacement chain has to
       * unwind newest-first for the same reason.
       */
      const prescriptions = await sql`
        select id from public.prescriptions
        where practice_location_id in ${sql(locationIds)}`;
      if (prescriptions.length > 0) {
        const rxIds = prescriptions.map((r) => r.id);
        await sql`delete from public.prescription_events where prescription_id in ${sql(rxIds)}`;
        await sql`delete from public.prescription_items where prescription_id in ${sql(rxIds)}`;
        await sql`update public.prescriptions set replaces_prescription_id = null
                  where id in ${sql(rxIds)}`;
        await sql`delete from public.prescriptions where id in ${sql(rxIds)}`;
      }

      const encounters = await sql`
        select id from public.encounters
        where practice_location_id in ${sql(locationIds)}`;
      if (encounters.length > 0) {
        const encounterIds = encounters.map((e) => e.id);
        await sql`delete from public.encounter_events
                  where encounter_id in ${sql(encounterIds)}`;
        await sql`delete from public.encounter_diagnoses
                  where encounter_id in ${sql(encounterIds)}`;
        await sql`delete from public.encounter_investigations
                  where encounter_id in ${sql(encounterIds)}`;
        await sql`delete from public.encounters where id in ${sql(encounterIds)}`;
      }

      // Queue history next: queue_events and queue_entries RESTRICT on the
      // appointment, so the appointment cannot go until they have.
      await sql`delete from public.queue_events
                where practice_location_id in ${sql(locationIds)}`;
      await sql`delete from public.queue_entries
                where practice_location_id in ${sql(locationIds)}`;
      await sql`delete from public.appointment_events
                where practice_location_id in ${sql(locationIds)}`;
      await sql`delete from public.appointments
                where practice_location_id in ${sql(locationIds)}`;
      await sql`delete from public.appointment_token_counters
                where practice_location_id in ${sql(locationIds)}`;
    }

    const doctors = await sql`
      select id from public.doctor_profiles where user_id in ${sql(ids)}`;
    if (doctors.length > 0) {
      await sql`delete from public.patients
                where owner_doctor_id in ${sql(doctors.map((d) => d.id))}`;
    }
  }

  for (const r of rows) {
    await sql`delete from public.practice_locations where created_by = ${r.id}`;
    await sql`delete from auth.users where id = ${r.id}`;
  }
  console.log(`removed ${rows.length} QA account(s): ${rows.map((r) => r.email).join(", ") || "none"}`);

  const [left] = await sql`
    select
      (select count(*)::int from auth.users where email like ${"%" + QA_DOMAIN}) as users,
      (select count(*)::int from public.patients)             as patients,
      (select count(*)::int from public.prescription_templates) as templates,
      (select count(*)::int from storage.objects where bucket_id = 'doctor-assets') as signatures`;
  console.log("remaining:", left);
  if (left.signatures > 0) {
    console.log("NOTE: storage objects cannot be deleted with SQL — use the Storage API.");
  }
  await sql.end();
  process.exit(0);
}

if (mode === "status") {
  const rows = await sql`
    select u.email, p.full_name from auth.users u
    join public.profiles p on p.id = u.id
    where u.email like ${"%" + QA_DOMAIN} order by u.email`;
  console.log(rows.length ? rows : "no QA accounts");
  await sql.end();
  process.exit(0);
}

if (mode !== "create") {
  console.error(`unknown mode "${mode}" — use create | destroy | status`);
  await sql.end();
  process.exit(1);
}

const existing = await sql`select email from auth.users where email like ${"%" + QA_DOMAIN}`;
if (existing.length > 0) {
  console.log("QA accounts already exist. Run `npm run qa:destroy` first.");
  console.log(existing.map((r) => r.email).join("\n"));
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  const doctorUser = await createUser(tx, PEOPLE.doctor.email, PEOPLE.doctor.name);
  const otherUser = await createUser(tx, PEOPLE.other.email, PEOPLE.other.name);
  const deskUser = await createUser(tx, PEOPLE.reception.email, PEOPLE.reception.name);

  await tx`insert into public.doctor_profiles (user_id, qualification, specialization,
             designation, bmdc_registration_no, patient_number_prefix)
           values (${doctorUser}, 'MBBS, FCPS (Medicine)', 'Internal Medicine',
                   'Associate Professor', 'A-00000', 'AR')`;
  await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
           values (${otherUser}, 'KU')`;

  // A private chamber (doctor alone) and a hospital (shared with reception).
  const [chamber] = await tx`
    insert into public.practice_locations (name, type, address, district, phone, created_by)
    values ('Greenview Chamber', 'PERSONAL_CHAMBER', '12 Green Road', 'Dhaka',
            '01700000000', ${doctorUser}) returning id`;
  const [hospital] = await tx`
    insert into public.practice_locations (name, type, address, district, phone, created_by)
    values ('Metro Hospital', 'HOSPITAL', '9 Airport Road', 'Dhaka',
            '01800000000', ${doctorUser}) returning id`;

  await tx`insert into public.practice_location_members
             (practice_location_id, user_id, role, status)
           values
             (${chamber.id},  ${doctorUser}, 'DOCTOR', 'ACTIVE'),
             (${chamber.id},  ${doctorUser}, 'LOCATION_ADMIN', 'ACTIVE'),
             (${hospital.id}, ${doctorUser}, 'DOCTOR', 'ACTIVE'),
             (${hospital.id}, ${doctorUser}, 'LOCATION_ADMIN', 'ACTIVE'),
             (${hospital.id}, ${deskUser},   'RECEPTIONIST', 'ACTIVE'),
             (${hospital.id}, ${otherUser},  'DOCTOR', 'ACTIVE')`;
});

console.log(`created (password for all: ${PASSWORD})\n`);
for (const [role, p] of Object.entries(PEOPLE)) {
  console.log(`  ${role.padEnd(10)} ${p.email}`);
}
console.log(`
  Greenview Chamber  doctor only
  Metro Hospital     doctor + reception + a second doctor
`);

await sql.end();
