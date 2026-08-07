import { defineConfig } from "drizzle-kit";

/**
 * Migrations only. DATABASE_URL is the direct Postgres connection string from
 * the Supabase dashboard and must live in .env.local — never committed.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  verbose: true,
  strict: true,
});
