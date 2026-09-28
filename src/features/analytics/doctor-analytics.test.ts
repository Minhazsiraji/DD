import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { analyticsDateRange } from "./period";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("Doctor Analytics presentation contract", () => {
  it("builds chamber-local inclusive Today, 7-day and 30-day ranges", () => {
    expect(analyticsDateRange("2026-09-28", 1)).toEqual({
      startDate: "2026-09-28",
      endDateExclusive: "2026-09-29",
      endDateInclusive: "2026-09-28",
    });
    expect(analyticsDateRange("2026-09-28", 7).startDate).toBe("2026-09-22");
    expect(analyticsDateRange("2026-09-28", 30).startDate).toBe("2026-08-30");
  });

  it("scopes every primary read to the doctor and active chamber", () => {
    const source = read("src/features/analytics/doctor-analytics.ts");
    expect(source.match(/\.eq\("owner_doctor_id", authority\.doctorId\)/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(source.match(/\.eq\("practice_location_id", authority\.locationId\)/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('supabase.rpc("finalized_prescriptions_at"');
    expect(source).toContain("ownedFinalizedEncounterIds.has(row.encounter_id)");
  });

  it("loads no patient identity fields and uses no elevated client", () => {
    const source = read("src/features/analytics/doctor-analytics.ts");
    expect(source).not.toMatch(/patient_name|full_name|phone|patient_number/iu);
    expect(source).not.toMatch(/service.?role|SUPABASE_SERVICE/iu);
    expect(source).toContain("createSupabaseServerClient");
  });

  it("renders loading, unavailable and true-empty states without false zeroes", () => {
    const page = read("src/app/(app)/analytics/page.tsx");
    const loading = read("src/app/(app)/analytics/loading.tsx");
    const view = read("src/features/analytics/components/analytics-dashboard.tsx");
    expect(page).toContain("getDoctorAnalytics(period)");
    expect(loading).toContain("Loading Doctor Analytics");
    expect(view).toContain("Analytics unavailable");
    expect(view).toContain("This is a true empty result");
    expect(view).toContain("no zero values are shown");
  });
});
