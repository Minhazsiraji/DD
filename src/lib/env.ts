import { z } from "zod";

/**
 * Environment validation.
 *
 * Fail fast and loudly at boot rather than producing a confusing auth error
 * three screens later. Public values are validated eagerly; server-only values
 * are validated lazily so the client bundle never touches them.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url("NEXT_PUBLIC_SUPABASE_URL must be a full URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short"),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required for migrations"),
  AI_MODE: z.enum(["mock", "live"]).default("mock"),
  NOTIFICATION_MODE: z.enum(["mock", "live"]).default("mock"),
  PAYMENT_MODE: z.enum(["mock", "live"]).default("mock"),
});

let cachedPublicEnv: z.infer<typeof publicSchema> | null = null;

/**
 * Validated on first use rather than at import, so `next build` can prerender
 * pages that never touch Supabase without requiring credentials to be present.
 * Misconfiguration still fails fast — just at the first call instead of at boot.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only when referenced statically,
 * so these must be written out in full rather than looked up dynamically.
 */
export function publicEnv() {
  cachedPublicEnv ??= publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
  return cachedPublicEnv;
}

let cachedServerEnv: z.infer<typeof serverSchema> | null = null;

export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() must never be called from client code");
  }
  cachedServerEnv ??= serverSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    AI_MODE: process.env.AI_MODE,
    NOTIFICATION_MODE: process.env.NOTIFICATION_MODE,
    PAYMENT_MODE: process.env.PAYMENT_MODE,
  });
  return cachedServerEnv;
}

/**
 * The service-role key is read ONLY here and ONLY by src/db/admin.ts.
 * It must never be prefixed NEXT_PUBLIC_ and never reach the browser.
 */
export function serviceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("Service role key requested from client code");
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is required only for migrations " +
        "and seeding, never for request-path code.",
    );
  }
  return key;
}
