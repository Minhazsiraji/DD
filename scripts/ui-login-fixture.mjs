/**
 * ONE temporary synthetic doctor, so a screen can be looked at in a browser.
 *
 *   node --env-file=.env.local scripts/ui-login-fixture.mjs create
 *   node --env-file=.env.local scripts/ui-login-fixture.mjs remove
 *
 * WHY THIS EXISTS ALONGSIDE `qa:create`.
 *
 * `qa:create` refuses while any `@qa.invalid` account exists, and this project
 * currently holds four password-less rows left behind by an aborted
 * verification run. Those must NOT be cleaned up here: `qa:destroy` also
 * removes preserved finalised-prescription and frozen-signature fixtures, which
 * are deliberately kept.
 *
 * So this creates exactly one account, records exactly what it created, and
 * removes exactly that. CLEANUP IS PROVENANCE-BASED — it deletes the ids in the
 * state file, never everything matching a pattern. A broad "delete all QA rows"
 * is precisely the thing that would destroy the preserved clinical fixtures.
 *
 * The identity is obviously synthetic (`@uifixture.invalid`), the password is
 * a throwaway constant, and nothing here touches a real patient, prescription
 * or signature.
 */
import postgres from "postgres";
import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";

const STATE =
  process.env.UI_FIXTURE_STATE ??
  "C:/Users/MINHAZ~1.SIR/AppData/Local/Temp/claude/E--Minhaz-Siraji-Claude/50998f40-e91f-44ce-9f4a-defecb98c18f/scratchpad/ui-fixture.json";

const EMAIL = "medicines-ui@uifixture.invalid";
const PASSWORD = "UiFixture12345";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const mode = process.argv[2] ?? "status";

try {
  if (mode === "create") {
    const existing = await sql`select id from auth.users where email = ${EMAIL}`;
    if (existing.length > 0) {
      console.log(`already exists: ${EMAIL} / ${PASSWORD}`);
    } else {
      const userId = crypto.randomUUID();
      const state = { userId, email: EMAIL };

      const [{ nspname: ext }] = await sql`
        select n.nspname from pg_extension e
        join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto'`;

      await sql.unsafe(
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
        [userId, EMAIL, PASSWORD],
      );
      await sql`
        insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                     last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), ${userId}, ${userId},
                ${sql.json({ sub: userId, email: EMAIL, email_verified: true })},
                'email', now(), now(), now())`;

      await sql`insert into public.profiles (id, full_name)
                values (${userId}, 'UI Fixture Doctor')`;

      const [doctor] = await sql`
        insert into public.doctor_profiles (user_id, patient_number_prefix, bmdc_registration_no)
        values (${userId}, 'UF', ${"UF" + crypto.randomBytes(3).toString("hex")})
        returning id`;
      state.doctorProfileId = doctor.id;

      const [loc] = await sql`
        insert into public.practice_locations (name, type, created_by)
        values ('UI Fixture Chamber', 'PERSONAL_CHAMBER', ${userId}) returning id`;
      state.locationId = loc.id;

      await sql`
        insert into public.practice_location_members
          (practice_location_id, user_id, role, status)
        values (${loc.id}, ${userId}, 'DOCTOR', 'ACTIVE')`;

      writeFileSync(STATE, JSON.stringify(state, null, 2));
      console.log(`created ${EMAIL} / ${PASSWORD}`);
      console.log(`state: ${STATE}`);
    }
  } else if (mode === "remove") {
    if (!existsSync(STATE)) {
      console.log("no state file — nothing this script created is recorded, so nothing removed.");
    } else {
      const state = JSON.parse(readFileSync(STATE, "utf8"));

      /**
       * By id, in dependency order. Never by pattern: a `like '%invalid%'`
       * delete here would take the preserved fixtures with it.
       */
      const meds = await sql`
        delete from public.doctor_medicines
        where doctor_profile_id = ${state.doctorProfileId} returning id`;
      await sql`delete from public.practice_location_members
                where user_id = ${state.userId}`;
      await sql`delete from public.practice_locations where id = ${state.locationId}`;
      await sql`delete from public.doctor_profiles where id = ${state.doctorProfileId}`;
      await sql`delete from public.profiles where id = ${state.userId}`;
      await sql`delete from auth.identities where user_id = ${state.userId}`;
      const users = await sql`delete from auth.users where id = ${state.userId} returning id`;

      rmSync(STATE);
      console.log(
        `removed ${users.length} user, 1 doctor profile, 1 location, ${meds.length} saved medicine(s)`,
      );

      const left = await sql`select count(*)::int as n from auth.users where email = ${EMAIL}`;
      console.log(`remaining ${EMAIL}: ${left[0].n}`);
    }
  } else {
    const rows = await sql`select id, email from auth.users where email = ${EMAIL}`;
    console.log(rows.length ? rows : "no UI fixture account");
  }
} finally {
  // In `finally`: an aborted run must still close the pool.
  await sql.end({ timeout: 5 });
}
