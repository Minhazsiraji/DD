import { redirect } from "next/navigation";
import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { getNavCounts } from "@/features/queue/nav-counts";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { TopBar } from "@/components/layout/top-bar";
import type { LocationOption } from "@/components/layout/location-switcher";
import { requireUser, getMemberships, ACTIVE_LOCATION_COOKIE } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { IdleLock } from "@/features/security/components/idle-lock";
import { SHARED_DEVICE_COOKIE } from "@/features/security/policy";
import { localDateInTimeZone } from "@/features/patients/m1-context";
import { todayInDhaka } from "@/features/appointments/schema";
import { logPreviewElapsed, startPreviewTimer, timedPreviewStage } from "@/lib/preview-timing";
import { BackgroundCanvas } from "@/features/settings/components/background-canvas";

/**
 * Authenticated clinical workspace shell.
 *
 * PRE-LAUNCH-SEC-01B makes AAL2 mandatory for every user who reaches this
 * clinical surface. The database independently enforces the same requirement;
 * these redirects are UX, never the authority boundary.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const shellStarted = startPreviewTimer();
  const supabasePromise = createSupabaseServerClient();
  const userPromise = timedPreviewStage("m1-shell-timing", "verified_user", requireUser());
  const membershipsPromise = timedPreviewStage("m1-shell-timing", "memberships", getMemberships());
  const cookiePromise = cookies();
  const aalPromise = supabasePromise.then((supabase) =>
    timedPreviewStage(
      "m1-shell-timing",
      "mfa_aal",
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ),
  );
  const doctorNamePromise = Promise.all([supabasePromise, userPromise]).then(
    async ([supabase, user]) => {
      const { data: profile } = await timedPreviewStage(
        "m1-shell-timing",
        "profile",
        supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      );
      return profile?.full_name ?? user.email?.split("@")[0] ?? "Doctor";
    },
  );

  const [user, memberships, aalResult, cookieStore] = await Promise.all([
    userPromise,
    membershipsPromise,
    aalPromise,
    cookiePromise,
  ]);

  const currentAal = aalResult.data?.currentLevel ?? null;
  const nextAal = aalResult.data?.nextLevel ?? null;

  if (currentAal !== "aal2") {
    redirect(nextAal === "aal2" ? "/mfa" : "/mfa/enroll");
  }

  if (memberships.length === 0) redirect("/onboarding");

  const locations: LocationOption[] = memberships.map((membership) => ({
    id: membership.locationId,
    name: membership.locationName,
    type: membership.locationType,
    roles: membership.roles,
  }));

  const sharedDevice = cookieStore.get(SHARED_DEVICE_COOKIE)?.value === "1";
  const requested = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value;
  const activeMembership =
    memberships.find((membership) => membership.locationId === requested) ?? memberships[0]!;
  const activeLocationId = activeMembership.locationId;
  const sessionDate = activeMembership.timeZone
    ? localDateInTimeZone(activeMembership.timeZone)
    : todayInDhaka();
  const fallbackDoctorName = user.email?.split("@")[0] ?? "Doctor";

  const navCountsPromise = timedPreviewStage(
    "m1-shell-timing",
    "nav_counts_streamed",
    getNavCounts(activeLocationId, sessionDate),
  ).catch(() => {
    console.error("[nav-counts] streamed read failed");
    return {};
  });

  logPreviewElapsed("m1-shell-timing", "secure_shell_ready", shellStarted);

  return (
    <div className="flex min-h-dvh min-w-0 overflow-x-clip">
      <BackgroundCanvas />
      <DesktopSidebar countsPromise={navCountsPromise} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          doctorNamePromise={doctorNamePromise}
          fallbackDoctorName={fallbackDoctorName}
          locations={locations}
          activeLocationId={activeLocationId}
        />

        <main
          id="main"
          className="mx-auto min-w-0 w-full max-w-[1400px] flex-1 overflow-x-clip px-4 py-5 pb-[calc(76px+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 lg:pb-8"
        >
          {children}
        </main>
      </div>

      <MobileBottomNav />
      <IdleLock sharedDevice={sharedDevice} />
    </div>
  );
}
