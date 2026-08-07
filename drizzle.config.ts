import { defineConfig } from "drizzle-kit";

/**
 * Migrations only. Both URLs live in .env.local and are never committed.
 *
 * Prefers DIRECT_URL (session pooler, port 5432). Supabase's transaction
 * pooler on 6543 does not support the prepared statements and DDL that
 * drizzle-kit needs, so pointing migrations at it fails in confusing ways.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
