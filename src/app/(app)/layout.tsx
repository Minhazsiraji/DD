import { redirect } from "next/navigation";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { getNavCounts } from "@/features/queue/nav-counts";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { TopBar } from "@/components/layout/top-bar";
import type { LocationOption, LocationType } from "@/components/layout/location-switcher";
import { requireUser, getMemberships, ACTIVE_LOCATION_COOKIE } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { IdleLock } from "@/features/security/components/idle-lock";
import { SHARED_DEVICE_COOKIE, requiresMfaChallenge } from "@/features/security/policy";
import { redirect as nextRedirect } from "next/navigation";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (requiresMfaChallenge(aal?.currentLevel ?? null, aal?.nextLevel ?? null)) {
    nextRedirect("/mfa");
  }

  const memberships = await getMemberships();
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
  const activeLocationId = locations.find((c) => c.id === requested)?.id ?? locations[0]!.id;

  const doctorName = profile?.full_name ?? user.email?.split("@")[0] ?? "Doctor";
  const navCounts = await getNavCounts(activeLocationId);

  return (
    <div className="flex min-h-dvh min-w-0 overflow-x-clip">
      <DesktopSidebar counts={navCounts} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          doctorName={doctorName}
          locations={locations}
          activeLocationId={activeLocationId}
        />

        <main
          id="main"
          className="mx-auto min-w-0 w-full max-w-[1420px] flex-1 overflow-x-clip px-3.5 py-4 pb-[calc(72px+env(safe-area-inset-bottom))] sm:px-5 sm:py-5 lg:px-4 lg:pb-6 xl:px-5"
        >
          {children}
        </main>
      </div>

      <MobileBottomNav />
      <IdleLock sharedDevice={sharedDevice} />
    </div>
  );
}
