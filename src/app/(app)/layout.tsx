import { DesktopSidebar } from "@/components/layout/desktop-sidebar";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { TopBar } from "@/components/layout/top-bar";
import { dashboardData } from "@/mocks/dashboard";

/**
 * The authenticated workspace shell.
 *
 * Desktop (≥ xl) : sidebar + workspace
 * Tablet  (lg)   : icon rail + workspace
 * Mobile  (< lg) : compact header + workspace + bottom navigation
 *
 * Phase 2 replaces the mock doctor with the resolved session; the layout itself
 * should not need to change.
 *
 * Tenancy is DOCTOR-owned: the location switcher filters the working day, it
 * does not scope patient data.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  const { doctor, locations, activeLocationId } = dashboardData;

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          doctorName={doctor.fullName}
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
    </div>
  );
}
