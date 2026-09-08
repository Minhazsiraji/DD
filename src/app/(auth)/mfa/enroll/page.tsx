import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MfaPanel } from "@/features/security/components/security-panels";
import { listFactorsAction } from "@/features/security/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up two-step verification" };

/**
 * Mandatory-MFA enrollment lives outside the clinical app layout so an AAL1
 * user can reach it before they have clinical authority. Enrollment/challenge
 * use Supabase Auth only; no patient/clinical query is performed here.
 */
export default async function MfaEnrollPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const current = aal?.currentLevel ?? null;
  const next = aal?.nextLevel ?? null;

  if (current === "aal2") redirect("/dashboard");
  if (next === "aal2") redirect("/mfa");

  const factors = await listFactorsAction();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-2xl border border-hairline bg-white shadow-sm">
        <div className="border-b border-hairline px-4 py-4 sm:px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
            Account security
          </p>
          <h1 className="mt-1 text-xl font-semibold text-ink">
            Set up two-step verification
          </h1>
          <p className="mt-2 text-sm text-ink-secondary">
            Clinical access requires an authenticator-backed session. Add a TOTP
            authenticator here, then complete the verification challenge.
          </p>
        </div>
        <MfaPanel factors={factors} />
      </section>
    </main>
  );
}
