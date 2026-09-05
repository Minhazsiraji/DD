import { expectSqlFailure } from "./p0-b2-lib.mjs";

export async function insertAuthProfile(sql, id, label) {
  const safe = String(label).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40);
  const email = `dd.p1.${safe}.${String(id).slice(0, 8)}@qa.invalid`;
  await sql`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', ${id},
      'authenticated', 'authenticated', ${email}, '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    )
  `;
  await sql`
    insert into public.profiles(id, full_name, onboarded_at)
    values (${id}, ${`QA P1 ${label}`}, now())
  `;
}

export async function asAuthenticated(sql, uid, action) {
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await sql.unsafe("set local role authenticated");
  try {
    return await action();
  } finally {
    await sql.unsafe("reset role");
    await sql`select set_config('request.jwt.claims', '', true)`;
  }
}

export async function expectAuthenticatedSqlFailure(sql, uid, label, action, expectedCodes = []) {
  return asAuthenticated(sql, uid, () =>
    expectSqlFailure(sql, label, action, expectedCodes));
}
