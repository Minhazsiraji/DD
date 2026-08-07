import { redirect } from "next/navigation";

/**
 * Phase 2 replaces this with a session check: signed in -> /dashboard,
 * otherwise -> /login.
 */
export default function RootPage() {
  redirect("/dashboard");
}
