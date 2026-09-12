import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngagedMinute } from "./engagement";
import { clinicDay } from "./engagement";
import type { ActivityContribution, ActivitySink, EngagementMinuteStore } from "./ports";
import { A_FEATURE_CODES, buildEngagementPayload } from "./surfaces";

/**
 * INTEGRATION PROOF: route → ingest → producer → sink.
 *
 * Everything between the HTTP body and the rows handed to O1-F is the real
 * implementation — the route handler, the strict body schema, the server
 * stamping, the minute store re-read and the producer. Only the four things the
 * route cannot own in a unit test are substituted: the verified session, the
 * Supabase client, the location memberships and the cookie jar.
 *
 * THIS FILE EXISTS BECAUSE UNIT TESTS MISSED A REAL DEFECT. The producer used
 * to take a "registered feature codes" set that defaulted to empty, and the
 * route never supplied one — so `DOCTOR_FEATURE_TOUCH_DAILY` rows existed in
 * every unit test and in no production request. A test that runs the route is
 * the only kind that catches that class of bug.
 */

const DOCTOR = "11111111-2222-4333-8444-555555555555";
const ZONE = "Asia/Dhaka";
const LOCATION = "9a7b6c5d-2222-4333-8444-555566667777";

let stored: Array<{ doctorId: string; periodDay: string; minute: EngagedMinute }> = [];
let ingested: ActivityContribution[][] = [];

/** A real in-memory store with the append-only, distinct-day semantics of the contract. */
const minuteStore: EngagementMinuteStore = {
  wired: true,
  async record(doctorId, periodDay, minute) {
    stored.push({ doctorId, periodDay, minute });
    return "RECORDED";
  },
  async snapshot(doctorId, periodDay) {
    return stored
      .filter((s) => s.doctorId === doctorId && s.periodDay === periodDay)
      .map((s) => s.minute);
  },
};

const activitySink: ActivitySink = {
  wired: true,
  async ingest(rows) {
    ingested.push([...rows]);
    return { status: "RECORDED", accepted: rows.length };
  },
};

vi.mock("@/features/engagement/ports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ports")>()),
  // Only the wiring point is replaced. Every constant and guard is the real one.
  getEngagementPorts: () => ({
    minuteStore,
    activitySink,
    timeSavedInputs: { wired: false, baseline: async () => "UNWIRED" as const, measuredWorkflow: async () => "UNWIRED" as const },
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  ACTIVE_LOCATION_COOKIE: "dd_active_location",
  requireUser: async () => ({ id: "6c5d4e3f-2222-4333-8444-555566667777" }),
  getMemberships: async () => [{ locationId: LOCATION, timeZone: ZONE }],
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }) } },
    rpc: async (fn: string) =>
      fn === "current_doctor_id" ? { data: DOCTOR, error: null } : { data: null, error: new Error("no") },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "dd_active_location" ? { value: LOCATION } : undefined) }),
}));

const { POST } = await import("@/app/api/engagement/route");
const { NextRequest } = await import("next/server");

/** Drive the real route with a body the real browser helper produced. */
async function beaconFrom(pathname: string) {
  const payload = buildEngagementPayload(pathname);
  expect(payload, `${pathname} must classify to a surface`).not.toBeNull();
  const request = new NextRequest("http://localhost:3200/api/engagement", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return POST(request);
}

const today = () => clinicDay(new Date().toISOString(), ZONE);
const lastRows = () => ingested.at(-1)!;
const rowFor = (metricCode: string, featureCode?: string) =>
  lastRows().find(
    (r) => r.metricCode === metricCode && (featureCode === undefined || r.featureCode === featureCode),
  );

beforeEach(() => {
  stored = [];
  ingested = [];
});

describe("a real request produces real feature-touch rows", () => {
  it("a CONSULTATION beacon reaches the sink as a consultation touch", async () => {
    const response = await beaconFrom("/consultation/3f1c2b7a-1111-4222-8333-444455556666");
    expect(response.status).toBe(204);

    expect(ingested).toHaveLength(1);
    const touch = rowFor("DOCTOR_FEATURE_TOUCH_DAILY", "consultation");
    expect(touch, "the route must produce a consultation feature touch").toBeDefined();
    expect(touch!.value).toBe(1);
    expect(touch!.periodDay).toBe(today());
    expect(touch!.doctorId).toBe(DOCTOR);
    expect(A_FEATURE_CODES.has(touch!.featureCode)).toBe(true);
  });

  it("a SETTINGS beacon reaches the sink as a settings touch", async () => {
    expect((await beaconFrom("/settings/profile")).status).toBe(204);
    expect(rowFor("DOCTOR_FEATURE_TOUCH_DAILY", "settings")).toBeDefined();
  });

  /**
   * SETTINGS-ONLY, end to end. The touch is recorded because configuring the
   * product is a real onboarding signal; the day is not active and the headline
   * engaged minutes are zero, because configuring is not practising.
   */
  it("SETTINGS alone: touch yes, engaged minutes 0, active day 0", async () => {
    await beaconFrom("/settings");
    await beaconFrom("/settings/profile");

    expect(rowFor("DOCTOR_FEATURE_TOUCH_DAILY", "settings")).toBeDefined();
    expect(rowFor("DOCTOR_ENGAGED_MINUTES_DAILY")!.value).toBe(0);
    expect(rowFor("DOCTOR_ACTIVE_DAY")!.value).toBe(0);
    expect(rowFor("DOCTOR_SESSION_COUNT_DAILY")!.value).toBe(0);
  });

  /** A qualifying surface in the same day does make it active, settings included. */
  it("one qualifying minute makes the day active while settings still shows its touch", async () => {
    await beaconFrom("/settings");
    await beaconFrom("/queue");

    expect(rowFor("DOCTOR_ACTIVE_DAY")!.value).toBe(1);
    expect(rowFor("DOCTOR_ENGAGED_MINUTES_DAILY")!.value).toBe(1);
    expect(rowFor("DOCTOR_FEATURE_TOUCH_DAILY", "settings")).toBeDefined();
    expect(rowFor("DOCTOR_FEATURE_TOUCH_DAILY", "queue")).toBeDefined();
  });

  /** Route-level privacy: nothing on the wire but the frozen vocabulary. */
  it("sends no path, id or timestamp through the real route", async () => {
    await beaconFrom("/patients/3f1c2b7a-1111-4222-8333-444455556666/documents/lab-report.pdf");
    const wire = JSON.stringify(lastRows());
    expect(wire).not.toContain("3f1c2b7a");
    expect(wire).not.toContain("lab-report");
    expect(wire).not.toContain("/");
    expect(wire).not.toMatch(/T\d{2}:\d{2}/);
    for (const row of lastRows()) {
      expect(Object.keys(row).sort()).toEqual(
        ["doctorId", "featureCode", "metricCode", "periodDay", "sourceStream", "sourceVersion", "value"],
      );
    }
  });

  /** The strict schema is enforced by the real handler, not only in unit tests. */
  it("the real route rejects a body carrying anything beyond the surface", async () => {
    const request = new NextRequest("http://localhost:3200/api/engagement", {
      method: "POST",
      body: JSON.stringify({ surface: "QUEUE", path: "/patients/3f1c2b7a" }),
    });
    expect((await POST(request)).status).toBe(400);
    expect(ingested).toHaveLength(0);
    expect(stored).toHaveLength(0);
  });
});
