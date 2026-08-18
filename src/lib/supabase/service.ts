import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serviceRoleKey } from "@/lib/env";

/**
 * ⚠ SERVICE ROLE — RLS DOES NOT APPLY TO ANYTHING THIS TOUCHES. ⚠
 *
 * The one privileged client in the request path, and it exists for exactly one
 * reason: `prescription-assets` has no INSERT policy for `authenticated`, by
 * design, so a frozen clinical asset can only be created by trusted code.
 *
 * WHAT THIS DELIBERATELY DOES NOT EXPOSE
 *
 * Only `.storage` is returned — never the client, never `.from()`, never
 * `.rpc()`. A privileged handle on the database would silently bypass every
 * tenancy rule in this application, and the way that happens is never a
 * decision; it is someone reaching for the client that was already imported.
 * So it is not reachable from here at all.
 *
 * WHAT IT MUST NEVER TOUCH
 *
 * `storage.objects` rows are metadata. Supabase treats that schema as
 * read-only and file operations go through the Storage API — inserting rows
 * directly produces a metadata entry with no object behind it, which is worse
 * than a failure because it looks like success.
 *
 * CONTAINMENT
 *
 *   • `import "server-only"` — importing this from a client component is a
 *     build error, not a runtime surprise.
 *   • the key is read through `serviceRoleKey()`, which throws if `window`
 *     exists and is never prefixed `NEXT_PUBLIC_`.
 *   • an ESLint rule forbids importing this outside the freeze module.
 *   • `service-key-containment.test.ts` asserts the key name and value appear
 *     in no client bundle.
 */

let cached: ReturnType<typeof createClient> | null = null;

function privilegedClient() {
  if (typeof window !== "undefined") {
    throw new Error("The service-role client was requested from client code");
  }
  cached ??= createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * Storage, and nothing else.
 *
 * Returning `client.storage` rather than the client is the whole containment
 * argument: there is no path from this module to a privileged table read.
 */
export function serviceStorage() {
  return privilegedClient().storage;
}

/** True when the deployment is configured to freeze signatures at all. */
export function canFreezeSignatures(): boolean {
  return typeof window === "undefined" && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
