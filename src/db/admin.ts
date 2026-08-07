import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * ⚠ SERVICE-ROLE / DIRECT DATABASE ACCESS — RLS DOES NOT APPLY HERE. ⚠
 *
 * This module is the ONLY place in the codebase permitted to open a privileged
 * connection. It exists for migrations, seeding and offline jobs.
 *
 * DO NOT import this from:
 *   • Server Actions          • Route Handlers
 *   • Server Components       • anything under src/features/**
 *
 * Request-path code must use `createSupabaseServerClient()`, which carries the
 * user's JWT so RLS is enforced. A missing WHERE clause there is caught by
 * Postgres; here it silently leaks every clinic's data.
 *
 * This restriction is enforced by an ESLint no-restricted-imports rule.
 */

let client: ReturnType<typeof postgres> | null = null;

export function adminDb() {
  const url = serverEnv().DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Direct database access is only available " +
        "locally for migrations and seeding — never in a deployed environment.",
    );
  }
  client ??= postgres(url, { max: 1, prepare: false });
  return drizzle(client, { schema });
}

export { schema };
