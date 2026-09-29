import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { analyticsDateRange } from "./period";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("Doctor Analytics presentation contract", () => {
  it("builds chamber-local Today, weekly, monthly and All Time ranges", () => {
    expect(analyticsDateRange("2026-09-28", 1)).toEqual({
      startDate: "2026-09-28",
      endDateExclusive: "2026-09-29",
      endDateInclusive: "2026-09-28",
    });
    expect(analyticsDateRange("2026-09-28", 7).startDate).toBe("2026-09-22");
    expect(analyticsDateRange("2026-09-28", 30).startDate).toBe("2026-08-30");
    expect(analyticsDateRange("2026-09-28", "all")).toEqual({
      startDate: null,
      endDateExclusive: "2026-09-29",
      endDateInclusive: "2026-09-28",
    });
  });

  it("labels Patient Count honestly as encounters without loading identifiers", () => {
    const source = read("src/features/analytics/doctor-analytics.ts");
    const view = read("src/features/analytics/components/analytics-dashboard.tsx");
    expect(source).toContain('select("id,status,started_at,completed_at")');
    expect(source).toContain("patientCount: encounters.length");
    expect(view).toContain("Patient encounters");
    expect(view).toContain("Consultations started in this period");
  });

  it("does not treat SaaS subscription payments or AI provider costs as practice finance", () => {
    const source = read("src/features/analytics/doctor-analytics.ts");
    expect(source).not.toMatch(/subscription_payments|owner_activity_cost|ai_usage/iu);
    expect(source).toContain('status: "authoritative"');
    expect(source).toContain('.from("practice_payments")');
    expect(source).toContain("Doctor’s Diary SaaS subscription billing remains excluded");
  });

  it("renders the four Doctor summary metrics as one responsive StatCard family", () => {
    const view = read("src/features/analytics/components/analytics-dashboard.tsx");
    expect(view).toContain("md:grid-cols-2 lg:grid-cols-4");
    expect(view).toContain('<StatCard label="Patient encounters"');
    expect(view).toContain('<StatCard label="Income" value={`৳${data.financials.income}`}');
    expect(view).toContain('<StatCard label="Cost" value={`−৳${data.financials.cost}`}');
    expect(view).toContain('<StatCard label="Net income" value={`৳${data.financials.netIncome}`}');
    expect(view).toContain("Income comes only from the practice payment ledger");
    expect(view).not.toContain("{data.financials.reason}");
  });

  it("scopes every primary read to the doctor and authorized chamber set", () => {
    const source = read("src/features/analytics/doctor-analytics.ts");
    expect(source.match(/\.eq\("owner_doctor_id", authority\.doctorId\)/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(source.match(/\.in\("practice_location_id", locationIds\)/gu)?.length).toBeGreaterThanOrEqual(3);
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
    expect(page).toContain("getDoctorAnalytics(period, requestedScope)");
    expect(loading).toContain("Loading Doctor Analytics");
    expect(view).toContain("Analytics unavailable");
    expect(view).toContain("This is a true empty result");
    expect(view).toContain("no zero values are shown");
  });
});
