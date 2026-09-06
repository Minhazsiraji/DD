import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const dashboard = () => read("src/app/(app)/dashboard/page.tsx");
const patients = () => read("src/features/patients/queries.ts");
const appointments = () => read("src/features/appointments/queries.ts");
const queue = () => read("src/features/queue/queries.ts");
const context = () => read("src/features/patients/m1-context.ts");
const timing = () => read("src/lib/preview-timing.ts");

describe("M1 Dashboard performance contract", () => {
  it("starts verified location, doctor scope and full authority together", () => {
    const source = dashboard();
    const location = source.indexOf('const locationPromise = timedPreviewStage("m1-dashboard-timing", "location_session_context"');
    const scope = source.indexOf('const scopePromise = timedPreviewStage("m1-dashboard-timing", "doctor_scope"');
    const authority = source.indexOf('const authorityPromise = timedPreviewStage("m1-dashboard-timing", "doctor_authority"');
    const firstAwait = source.indexOf("await Promise.all([locationPromise, scopePromise])");
    expect(location).toBeGreaterThan(0);
    expect(scope).toBeGreaterThan(location);
    expect(authority).toBeGreaterThan(scope);
    expect(authority).toBeLessThan(firstAwait);
    expect(context()).toContain("getM1LocationContext");
  });

  it("launches dashboard reads before waiting for full clinical authority", () => {
    const source = dashboard();
    expect(source).toMatch(/timedPreviewStage\("m1-dashboard-timing",\s*"profile"/);
    expect(source).toContain('timedPreviewStage("m1-dashboard-timing", "patient_count"');
    expect(source).toMatch(/timedPreviewStage\("m1-dashboard-timing",\s*"recent_patients"/);
    expect(source).toMatch(/timedPreviewStage\("m1-dashboard-timing",\s*"day_counts"/);
    expect(source).toMatch(/timedPreviewStage\("m1-dashboard-timing",\s*"queue_work_now"/);
    expect(source).toMatch(/Promise\.all\(\[\s*profilePromise,[\s\S]*authorityPromise/);
  });

  it("keeps Recent patients lightweight and owner-scoped before order/LIMIT", () => {
    const source = patients();
    const start = source.indexOf("export async function getDashboardRecentPatients");
    const end = source.indexOf("export type CountOutcome", start);
    const body = source.slice(start, end);
    expect(body).toContain("DASHBOARD_RECENT_COLUMNS");
    expect(body).not.toContain("patient_allergies");
    expect(source).toMatch(/DASHBOARD_RECENT_COLUMNS[\s\S]{0,240}patient_location_links\(practice_locations\(name\)\)/);
    expect(body.indexOf('.eq("owner_doctor_id", ownerDoctorId)')).toBeLessThan(body.indexOf('.order("created_at"'));
    expect(body.indexOf('.eq("owner_doctor_id", ownerDoctorId)')).toBeLessThan(body.indexOf(".limit(limit)"));
  });

  it("uses a lightweight day-count read rather than full appointment embeds", () => {
    const source = appointments();
    const start = source.indexOf("export async function getDashboardDayCounts");
    const end = source.indexOf("export async function getDayCounts", start);
    const body = source.slice(start, end);
    expect(body).toContain('.select("status, booking_source")');
    expect(body).toContain('.eq("practice_location_id", locationId)');
    expect(body).toContain('.eq("owner_doctor_id", ownerDoctorId)');
    expect(body).not.toContain("patients(");
    expect(body).not.toContain("doctor_profiles(");
  });

  it("preserves database-authoritative Work now ordering", () => {
    expect(dashboard()).toContain("getQueue(ctx.locationId, sessionDate)");
    expect(queue()).toContain('supabase.rpc("get_queue"');
    expect(queue()).toContain("Order is preserved exactly as returned");
  });

  it("keeps every requested Preview-only timing stage", () => {
    const source = dashboard();
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
    ]) {
      expect(source).toContain(stage);
    }
    expect(timing()).toContain('process.env.VERCEL_ENV === "preview"');
  });
});
