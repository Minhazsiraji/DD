import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HELPER = "src/features/perf/m1-preview-diagnostic.ts";
const PAGE = "src/app/dev/perf/m1/page.tsx";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("M1 PERF-01 preview diagnostic boundary", () => {
  it("refuses every non-Preview environment before authentication/data work", () => {
    const text = code(HELPER);
    const guard = text.indexOf('process.env.VERCEL_ENV !== "preview"');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("notFound()", guard)).toBeGreaterThan(guard);
    expect(guard).toBeLessThan(text.indexOf("requireUser()"));
  });

  it("preserves verified-user, MFA, and membership security gates", () => {
    const text = code(HELPER);
    expect(text).toContain("requireUser()");
    expect(text).toContain("getAuthenticatorAssuranceLevel()");
    expect(text).toContain("requiresMfaChallenge");
    expect(text).toContain("getMemberships()");
    expect(text).toContain("getM1FinderScope()");
    expect(text).not.toContain("getSession(");
  });
  it("measures the accepted M1 dashboard reads and isolates queue after auth is warm", () => {
    const text = code(HELPER);
    for (const call of [
      "getPatientCount(",
      "getDashboardRecentPatients(",
      "getDashboardDayCounts(",
      "getQueue(",
    ]) {
      expect(text).toContain(call);
    }
    expect(text.indexOf("requireUser()")).toBeLessThan(text.indexOf("getMemberships()"));
    expect(text.indexOf("getMemberships()")).toBeLessThan(text.indexOf("getM1FinderScope()"));
    expect(text.indexOf("getM1FinderScope()")).toBeLessThan(text.indexOf("getQueue("));
  });

  it("reports runtime region plus milliseconds only", () => {
    const helper = code(HELPER);
    const page = code(PAGE);
    expect(helper).toContain("process.env.VERCEL_REGION");
    expect(helper).toContain("vercelRegion:");
    expect(helper).toContain("timingsMs: timings");
    expect(page).toContain("JSON.stringify(diagnostic, null, 2)");
    for (const forbidden of [
      "patientName",
      "fullName",
      "email",
      "userId",
      "locationName",
      "roles:",
      "counts:",
    ]) {
      expect(page).not.toContain(forbidden);
    }
  });

  it("contains no service-role or direct database bypass", () => {
    const text = code(HELPER);
    expect(text).not.toMatch(/service[_-]?role/i);
    expect(text).not.toContain("createSupabaseServiceClient");
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("DIRECT_URL");
  });
});
