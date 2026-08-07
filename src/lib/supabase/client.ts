import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Browser Supabase client. Only ever holds the anon key plus the user's own
 * session — never a privileged credential.
 *
 * Use for auth UI (sign in, sign up, password reset) only. All data mutation
 * goes through Server Actions so authorization, validation and audit happen on
 * the server where the browser cannot skip them.
 */
export function createSupabaseBrowserClient() {
  const env = publicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
