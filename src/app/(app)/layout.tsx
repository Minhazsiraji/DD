import { redirect } from "next/navigation";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { TopBar } from "@/components/layout/top-bar";
import type { LocationOption, LocationType } from "@/components/layout/location-switcher";
import { requireUser, getMemberships, ACTIVE_LOCATION_COOKIE } from "@/lib/auth/session";
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
 * requireLocationContext(), and RLS still applies underneath.
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

  const [{ data: profile }, { data: locationRows }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("practice_locations")
      .select("id, name, type")
      .in(
        "id",
        memberships.map((m) => m.locationId),
      ),
  ]);

  const typeById = new Map(
    (locationRows ?? []).map((c) => [c.id as string, c.type as LocationType]),
  );

  const locations: LocationOption[] = memberships.map((m) => ({
    id: m.locationId,
    name: m.locationName,
    type: typeById.get(m.locationId) ?? "CLINIC",
    roles: m.roles,
  }));

  const cookieStore = await cookies();
  const sharedDevice = cookieStore.get(SHARED_DEVICE_COOKIE)?.value === "1";
  const requested = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value;
  const activeLocationId =
    locations.find((c) => c.id === requested)?.id ?? locations[0]!.id;

  const doctorName =
    profile?.full_name ?? user.email?.split("@")[0] ?? "Doctor";

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          doctorName={doctorName}
          locations={locations}
          activeLocationId={activeLocationId}
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


