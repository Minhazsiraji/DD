import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const dashboard = () => read("src/app/(app)/dashboard/page.tsx");
const layout = () => read("src/app/(app)/layout.tsx");
const sidebar = () => read("src/components/layout/desktop-sidebar.tsx");
const session = () => read("src/lib/auth/session.ts");
const patients = () => read("src/features/patients/queries.ts");
const appointments = () => read("src/features/appointments/queries.ts");
const queue = () => read("src/features/queue/queries.ts");
const timing = () => read("src/lib/preview-timing.ts");

describe("M1 shell + Dashboard performance contract", () => {
  it("starts verified user, MFA and memberships without a serial auth waterfall", () => {
    const source = layout();
    expect(source).toContain('const userPromise = timedPreviewStage("m1-shell-timing", "verified_user"');
    expect(source).toContain('const membershipsPromise = timedPreviewStage("m1-shell-timing", "memberships"');
    expect(source).toContain('"mfa_aal"');
    expect(source).toMatch(/Promise\.all\(\[\s*userPromise,\s*membershipsPromise,\s*aalPromise,\s*cookiePromise/);

    // SEC-01B strengthens the former conditional MFA helper into a mandatory
    // clinical AAL2 gate. Keep the performance contract (AAL is still started
    // concurrently) while asserting the new Auth-only challenge/enrollment UX.
    expect(source).toContain("const currentAal = aalResult.data?.currentLevel ?? null");
    expect(source).toContain("const nextAal = aalResult.data?.nextLevel ?? null");
    expect(source).toContain('if (currentAal !== "aal2")');
    expect(source).toContain('redirect(nextAal === "aal2" ? "/mfa" : "/mfa/enroll")');
  });

  it("uses membership-projected location metadata and removes the extra layout location query", () => {
    expect(session()).toContain("practice_locations(name, timezone, type)");
    expect(session()).toContain("locationType");
    expect(layout()).not.toContain('.from("practice_locations")');
    expect(layout()).toContain("type: membership.locationType");
  });

  it("streams nav badges and never awaits them before rendering shell chrome", () => {
    const source = layout();
    expect(source).toContain("const navCountsPromise = timedPreviewStage");
    expect(source).not.toMatch(/await\s+getNavCounts/);
    expect(source).toContain("<DesktopSidebar countsPromise={navCountsPromise}");
    expect(sidebar()).toContain("<React.Suspense fallback={null}>");
    expect(sidebar()).toContain("React.use(countsPromise)");
  });

  it("uses a lightweight appointment badge count and request-scoped queue dedupe", () => {
    const appt = appointments();
    expect(appt).toContain("export async function getAppointmentNavCount");
    expect(appt).toContain('.select("id", { count: "exact", head: true })');
    expect(queue()).toContain("export const getQueue = cache(async function getQueue");
    expect(queue()).toContain('"m1-queue-timing"');
    expect(queue()).toContain('"get_queue_rpc"');
  });

  it("streams Dashboard sections independently and leaves Quick Actions outside data awaits", () => {
    const source = dashboard();
    expect(source).toContain("<Suspense fallback={<DashboardHeaderFallback />}");
    expect(source).toContain("<Suspense fallback={<DashboardStatsFallback />}");
    expect(source).toContain('fallback={<SectionLoading title="Work now"');
    expect(source).toContain('fallback={<SectionLoading title="Recent patients"');
    expect(source).toContain("<QuickActions />");
    expect(source).not.toMatch(/const \[profileResult, patients, recent, today, queue, authority\] = await Promise\.all/);
  });

  it("keeps Recent patients lightweight and owner-scoped before order/LIMIT", () => {
    const source = patients();
    const start = source.indexOf("export async function getDashboardRecentPatients");
    const end = source.indexOf("export type CountOutcome", start);
    const body = source.slice(start, end);
    expect(body).toContain("DASHBOARD_RECENT_COLUMNS");
    expect(body).not.toContain("patient_allergies");
    expect(body.indexOf('.eq("owner_doctor_id", ownerDoctorId)')).toBeLessThan(body.indexOf('.order("created_at"'));
    expect(body.indexOf('.eq("owner_doctor_id", ownerDoctorId)')).toBeLessThan(body.indexOf(".limit(limit)"));
  });

  it("preserves DB-authoritative queue order and all Preview timing stages", () => {
    const source = dashboard();
    expect(source).toContain("getQueue(ctx.locationId, sessionDate)");
    expect(queue()).toContain('supabase.rpc("get_queue"');
    expect(queue()).toContain("Order is preserved exactly as returned");
    for (const stage of [
      "location_session_context",
      "doctor_scope",
      "doctor_authority",
      "profile",
      "patient_count",
      "recent_patients",
      "day_counts",
      "queue_work_now",
      "total_dashboard_server",
    ]) expect(source).toContain(stage);
    expect(timing()).toContain('process.env.VERCEL_ENV === "preview"');
  });
});
