import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChallengeForm } from "@/features/security/components/challenge-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiresMfaChallenge } from "@/features/security/policy";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function MfaPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  // Nothing to challenge — don't strand the user on a dead-end screen.
  if (!requiresMfaChallenge(aal?.currentLevel ?? null, aal?.nextLevel ?? null)) {
    redirect("/dashboard");
  }

  return <ChallengeForm />;
}
