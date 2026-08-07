import { redirect } from "next/navigation";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { TopBar } from "@/components/layout/top-bar";
import type { ClinicOption, ClinicType } from "@/components/layout/clinic-switcher";
import { requireUser, getMemberships, ACTIVE_CLINIC_COOKIE } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { IdleLock } from "@/features/security/components/idle-lock";
import { SHARED_DEVICE_COOKIE, requiresMfaChallenge } from "@/features/security/policy";
import { redirect as nextRedirect } from "next/navigation";

/**
 * The authenticated workspace shell.
 *
 * Desktop (≥ xl) : sidebar + workspace
 * Tablet  (lg)   : icon rail + workspace
 * Mobile  (< lg) : compact header + workspace + bottom navigation
 *
 * This redirect is convenience, not security. Every Server Action still calls
 * requireClinicContext(), and RLS still applies underneath.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  /**
   * A password-only session must never render the workspace when the account
   * has a verified second factor. Checked here rather than only in proxy.ts so
   * a direct request to a nested route cannot slip past.
   */
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (requiresMfaChallenge(aal?.currentLevel ?? null, aal?.nextLevel ?? null)) {
    nextRedirect("/mfa");
  }

  const memberships = await getMemberships();

  // Signed in but no clinic yet — finish setup first.
  if (memberships.length === 0) redirect("/onboarding");

  const [{ data: profile }, { data: clinicRows }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("clinics")
      .select("id, name, type")
      .in(
        "id",
        memberships.map((m) => m.clinicId),
      ),
  ]);

  const typeById = new Map(
    (clinicRows ?? []).map((c) => [c.id as string, c.type as ClinicType]),
  );

  const clinics: ClinicOption[] = memberships.map((m) => ({
    id: m.clinicId,
    name: m.clinicName,
    type: typeById.get(m.clinicId) ?? "CLINIC",
    roles: m.roles,
  }));

  const cookieStore = await cookies();
  const sharedDevice = cookieStore.get(SHARED_DEVICE_COOKIE)?.value === "1";
  const requested = cookieStore.get(ACTIVE_CLINIC_COOKIE)?.value;
  const activeClinicId =
    clinics.find((c) => c.id === requested)?.id ?? clinics[0]!.id;

  const doctorName =
    profile?.full_name ?? user.email?.split("@")[0] ?? "Doctor";

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          doctorName={doctorName}
          clinics={clinics}
          activeClinicId={activeClinicId}
        />

        <main
          id="main"
          className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 pb-[calc(76px+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 lg:pb-8"
        >
          {children}
        </main>
      </div>

      <MobileBottomNav />

      <IdleLock sharedDevice={sharedDevice} />
    </div>
  );
}
