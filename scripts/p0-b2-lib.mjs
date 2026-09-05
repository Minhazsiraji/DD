import postgres from "postgres";
import { requireLocalP0DatabaseUrl } from "./p0-target.mjs";

export function fail(message) {
  throw new Error(message);
}

export function assert(condition, message) {
  if (!condition) fail(message);
}

export function localDatabaseUrl() {
  return requireLocalP0DatabaseUrl();
}

export function openLocalDatabase() {
  return postgres(localDatabaseUrl(), {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
}

/*
 * Runtime-verifier-only local Supabase administrator connection.
 *
 * The target still comes exclusively from DD_V2_LOCAL_DATABASE_URL through
 * requireLocalP0DatabaseUrl(). We replace only the username with the
 * local Supabase superuser so runtime tests can establish an exact
 * SESSION AUTHORIZATION identity without weakening application roles.
 */
export function localAdminDatabaseUrl() {
  const value = new URL(localDatabaseUrl());

  value.username = "supabase_admin";

  return value.toString();
}

export function openLocalAdminDatabase() {
  return postgres(localAdminDatabaseUrl(), {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
}

export async function expectFailure(label, action, expectedCodes = []) {
  try {
    await action();
  } catch (error) {
    if (
      expectedCodes.length > 0 &&
      !expectedCodes.includes(error?.code)
    ) {
      fail(
        `${label}: failed with unexpected SQLSTATE ` +
        `${error?.code ?? "(none)"}: ${error?.message ?? error}`,
      );
    }

    return error;
  }

  fail(`${label}: unexpectedly succeeded`);
}

export function qaEmail(name) {
  return `dd.p0.${name}@qa.invalid`;
}

let savepointCounter = 0;

export async function expectSqlFailure(
  sql,
  label,
  action,
  expectedCodes = [],
) {
  savepointCounter += 1;
  const savepoint = `dd_p0_expected_failure_${savepointCounter}`;

  await sql.unsafe(`savepoint ${savepoint}`);

  let caught = null;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  try {
    await sql.unsafe(`rollback to savepoint ${savepoint}`);
    await sql.unsafe(`release savepoint ${savepoint}`);
  } catch (cleanupError) {
    fail(
      `${label}: failure cleanup failed: ` +
      `${cleanupError?.message ?? cleanupError}`,
    );
  }

  if (!caught) {
    fail(`${label}: unexpectedly succeeded`);
  }

  if (
    expectedCodes.length > 0 &&
    !expectedCodes.includes(caught?.code)
  ) {
    fail(
      `${label}: failed with unexpected SQLSTATE ` +
      `${caught?.code ?? "(none)"}: ${caught?.message ?? caught}`,
    );
  }

  return caught;
}
