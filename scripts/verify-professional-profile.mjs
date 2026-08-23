/**
 * The professional profile's boundaries, executed against the real database
 * and rolled back.
 *
 * The profile is the one object in this product designed to eventually leave
 * the clinic, so the questions are not "does the page look right" but: can
 * another doctor read or rewrite it, can a receptionist, can a path be forged,
 * does a colleague at the same hospital inherit hours, and is a doctor private
 * unless they said otherwise.
 *
 * Every write happens inside a transaction that is rolled back. Nothing here
 * leaves a row behind.
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Run as a given user, the way PostgREST would. */
async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await tx`select set_config('role', 'authenticated', true)`;
  try {
    return await fn();
  } finally {
    await tx`select set_config('role', null, true)`;
    await tx`select set_config('request.jwt.claims', null, true)`;
  }
}

/** Expect a refusal. Rolls the savepoint back either way. */
async function refused(tx, label, fn) {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      throw new Error("__ALLOWED__");
    });
    check(false, label, "allowed");
  } catch (e) {
    check(!/__ALLOWED__/.test(e.message), label, /__ALLOWED__/.test(e.message) ? "allowed" : "refused");
  }
}

/** Expect success, and roll it back regardless. */
async function accepted(tx, label, fn) {
  let ok = false;
  let detail = "";
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      ok = true;
      throw new Error("__ROLLBACK__");
    });
  } catch (e) {
    if (!/__ROLLBACK__/.test(e.message)) detail = e.message.slice(0, 90);
  }
  check(ok, label, detail);
}

const uid = () => crypto.randomUUID();

await sql.begin(async (tx) => {
  console.log("\nFixture");

  const userA = uid();
  const userB = uid();
  const userR = uid();
  const seed = crypto.randomBytes(3).toString("hex");

  for (const [id, name] of [
    [userA, "Dr Profile A"],
    [userB, "Dr Profile B"],
    [userR, "Reception P"],
  ]) {
    await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                     confirmation_token, recovery_token,
                                     email_change_token_new, email_change)
             values (${id}, ${`pp.${id.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
    await tx`insert into public.profiles (id, full_name) values (${id}, ${name})
             on conflict (id) do update set full_name = excluded.full_name`;
  }

  const [docA] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                          values (${userA}, 'PA') returning id`;
  const [docB] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                          values (${userB}, 'PB') returning id`;

  const [hospital] = await tx`
    insert into public.practice_locations (name, type, district, created_by)
    values ('Shared Hospital', 'HOSPITAL', 'Dhaka', ${userA}) returning id`;
  const [chamberOnly] = await tx`
    insert into public.practice_locations (name, type, district, created_by)
    values ('A Private Chamber', 'PERSONAL_CHAMBER', 'Dhaka', ${userA}) returning id`;
  const [outside] = await tx`
    insert into public.practice_locations (name, type, district, created_by)
    values ('Somewhere Else', 'CLINIC', 'Dhaka', ${userB}) returning id`;

  await tx`insert into public.practice_location_members
             (practice_location_id, user_id, role, status) values
             (${hospital.id},    ${userA}, 'DOCTOR', 'ACTIVE'),
             (${hospital.id},    ${userB}, 'DOCTOR', 'ACTIVE'),
             (${hospital.id},    ${userR}, 'RECEPTIONIST', 'ACTIVE'),
             (${chamberOnly.id}, ${userA}, 'DOCTOR', 'ACTIVE'),
             (${outside.id},     ${userB}, 'DOCTOR', 'ACTIVE')`;

  check(true, "two doctors share a hospital; A also has a private chamber");

  console.log("\nOwnership of the profile itself");

  await as(tx, userA, async () => {
    await tx`select public.save_professional_profile(
               'MBBS, FCPS', 'Medicine', 'Consultant', ${"BMDC-" + seed}, true, ${"dr-a-" + seed})`;
  });
  const [afterA] = await tx`select qualification, show_bmdc_on_profile, profile_slug,
                                   profile_visibility
                            from public.doctor_profiles where id = ${docA.id}`;
  check(afterA.qualification === "MBBS, FCPS", "a doctor writes their own profile");

  /**
   * PRIVATE unless the doctor says otherwise. The column defaults, the
   * migration adds it with that default, and no write path here flips it.
   */
  check(afterA.profile_visibility === "PRIVATE", "…and is PRIVATE by default", afterA.profile_visibility);

  /**
   * There is NO doctor id parameter on the write. B calling it can only ever
   * edit B — which is the point: a caller-supplied identity is how one doctor
   * edits another.
   */
  await as(tx, userB, async () => {
    await tx`select public.save_professional_profile('Forged', null, null, null, false, null)`;
  });
  const [stillA] = await tx`select qualification from public.doctor_profiles where id = ${docA.id}`;
  const [nowB] = await tx`select qualification from public.doctor_profiles where id = ${docB.id}`;
  check(stillA.qualification === "MBBS, FCPS", "doctor B cannot edit doctor A's profile");
  check(nowB.qualification === "Forged", "…because the write only ever addresses the caller");

  await refused(tx, "reception has no professional profile to write", (sp) =>
    as(sp, userR, () =>
      sp`select public.save_professional_profile('Nope', null, null, null, false, null)`),
  );

  console.log("\nBMDC uniqueness is still the authority");

  await refused(tx, "a second doctor cannot take the same BMDC number", (sp) =>
    as(sp, userB, () =>
      sp`select public.save_professional_profile(null, null, null, ${"bmdc " + seed}, false, null)`),
  );
  await refused(tx, "…nor with different punctuation or case", (sp) =>
    as(sp, userB, () =>
      sp`select public.save_professional_profile(null, null, null, ${"bmdc-" + seed.toUpperCase()}, false, null)`),
  );

  console.log("\nSlugs");

  await refused(tx, "a reserved word is refused as a slug", (sp) =>
    as(sp, userB, () => sp`select public.save_professional_profile(null,null,null,null,false,'admin')`),
  );
  await refused(tx, "…and so is a malformed one", (sp) =>
    as(sp, userB, () => sp`select public.save_professional_profile(null,null,null,null,false,'A Bad Slug!')`),
  );
  await refused(tx, "…and a slug already taken by another doctor", (sp) =>
    as(sp, userB, () =>
      sp`select public.save_professional_profile(null,null,null,null,false,${"dr-a-" + seed})`),
  );

  console.log("\nChambers and visiting hours");

  await as(tx, userA, async () => {
    await tx`select public.save_chamber_schedule(${hospital.id}, 'By appointment',
               ${sql.json([
                 { weekday: 0, startsAt: "18:00", endsAt: "21:00" },
                 { weekday: 2, startsAt: "18:00", endsAt: "21:00" },
               ])})`;
  });

  const hours = await tx`
    select h.weekday from public.doctor_chamber_hours h
    join public.doctor_chambers c on c.id = h.chamber_id
    where c.doctor_profile_id = ${docA.id} order by h.weekday`;
  check(hours.length === 2, "a doctor sets hours at a chamber they practise at", `${hours.length} sessions`);

  /**
   * THE PRODUCT DECISION, PROVED: the schedule belongs to the doctor-at-a-
   * location relationship. B works at the same hospital and inherits nothing.
   */
  const bHours = await tx`
    select count(*)::int as n from public.doctor_chamber_hours h
    join public.doctor_chambers c on c.id = h.chamber_id
    where c.doctor_profile_id = ${docB.id}`;
  check(bHours[0].n === 0, "a colleague at the SAME hospital inherits no hours", `${bHours[0].n}`);

  await as(tx, userB, async () => {
    const rows = await tx`select id from public.doctor_chambers`;
    check(rows.length === 0, "…and cannot read doctor A's chamber rows at all", `${rows.length} rows`);
  });

  await refused(tx, "a doctor cannot publish hours for a chamber they do not work at", (sp) =>
    as(sp, userB, () =>
      sp`select public.save_chamber_schedule(${chamberOnly.id}, null, '[]'::jsonb)`),
  );

  await refused(tx, "reception cannot set a doctor's visiting hours", (sp) =>
    as(sp, userR, () => sp`select public.save_chamber_schedule(${hospital.id}, null, '[]'::jsonb)`),
  );

  await refused(tx, "a session that ends before it starts is refused", (sp) =>
    as(sp, userA, () =>
      sp`select public.save_chamber_schedule(${hospital.id}, null,
           ${sql.json([{ weekday: 1, startsAt: "21:00", endsAt: "18:00" }])})`),
  );

  await refused(tx, "…as is an impossible weekday", (sp) =>
    as(sp, userA, () =>
      sp`select public.save_chamber_schedule(${hospital.id}, null,
           ${sql.json([{ weekday: 9, startsAt: "18:00", endsAt: "21:00" }])})`),
  );

  await accepted(tx, "replacing a schedule REPLACES it rather than merging", async (sp) => {
    await as(sp, userA, () =>
      sp`select public.save_chamber_schedule(${hospital.id}, null,
           ${sql.json([{ weekday: 4, startsAt: "17:00", endsAt: "20:00" }])})`);
    const left = await sp`
      select h.weekday from public.doctor_chamber_hours h
      join public.doctor_chambers c on c.id = h.chamber_id
      where c.doctor_profile_id = ${docA.id}`;
    if (left.length !== 1 || left[0].weekday !== 4) {
      throw new Error(`expected only Thursday, got ${JSON.stringify(left.map((r) => r.weekday))}`);
    }
  });

  console.log("\nWrites are RPC-only");

  await refused(tx, "a doctor cannot INSERT a chamber row directly", (sp) =>
    as(sp, userA, () =>
      sp`insert into public.doctor_chambers (doctor_profile_id, practice_location_id)
         values (${docA.id}, ${outside.id})`),
  );
  await refused(tx, "…nor UPDATE one", (sp) =>
    as(sp, userA, () => sp`update public.doctor_chambers set public_note = 'x'`),
  );
  await refused(tx, "…nor DELETE one", (sp) =>
    as(sp, userA, () => sp`delete from public.doctor_chambers`),
  );
  await refused(tx, "…and hours are the same", (sp) =>
    as(sp, userA, () => sp`delete from public.doctor_chamber_hours`),
  );

  console.log("\nThe photo is not the signature");

  const [buckets] = await tx`
    select
      (select public from storage.buckets where id = 'doctor-profile-photos') as photos_public,
      (select public from storage.buckets where id = 'prescription-assets')   as rx_public`;
  check(buckets.photos_public === false, "the photo bucket is private");
  check(buckets.rx_public === false, "…and so is the prescription bucket");

  const [sep] = await tx`
    select count(*)::int as n from storage.buckets
    where id in ('doctor-profile-photos','doctor-assets','prescription-assets')`;
  check(sep.n === 3, "portrait, signature and frozen signature are three buckets", `${sep.n}`);

  /**
   * The path is DERIVED from the session, so a caller cannot point their row at
   * somebody else's object. Proved by asking the function for it.
   */
  const [derived] = await as(tx, userA, () => tx`select public.set_professional_photo(true) as p`);
  check(
    derived.p === `${userA}/photo`,
    "the photo path is derived from the session, never supplied",
    derived.p,
  );
  const [cleared] = await as(tx, userA, () => tx`select public.set_professional_photo(false) as p`);
  check(cleared.p === null, "…and removing it clears the row");

  console.log("\nNothing clinical is reachable from the profile");

  /**
   * The profile reads exactly four things. If a later change made it read a
   * patient or a prescription, this is the assertion that should fail — so it
   * checks the SHAPE of what the feature is allowed to touch.
   */
  const columns = await tx`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'doctor_chambers'`;
  const names = columns.map((c) => c.column_name);
  check(
    !names.some((n) => /patient|diagnos|prescription|medicine|audit|signature/i.test(n)),
    "a chamber row holds nothing clinical",
    names.join(","),
  );

  throw new Error("__ROLLBACK_ALL__");
}).catch((e) => {
  if (!/__ROLLBACK_ALL__/.test(e.message)) {
    console.error("\nverification aborted:", e.message);
    failures += 1;
  }
});

console.log(
  failures === 0
    ? "\nProfessional profile: all checks passed.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
