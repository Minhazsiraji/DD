import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEngagementPayload } from "./surfaces";

/**
 * INTEGRATION PROOF: browser surface -> authenticated route -> canonical Doctor
 * resolution -> durable F-I2 minute writer.
 *
 * Daily aggregate projection is intentionally NOT asserted here anymore. F-I2
 * makes durable minute evidence authoritative and reconciliation owns the later
 * generation-backed A projection. This test protects the live route boundary:
 * the browser sends only one frozen surface while Doctor, minute and timezone
 * are supplied by trusted server authorities.
 */

const ACTOR = "6c5d4e3f-2222-4333-8444-555566667777";
const DOCTOR = "11111111-2222-4333-8444-555555555555";
const ZONE = "Asia/Dhaka";
const LOCATION = "9a7b6c5d-2222-4333-8444-555566667777";

let locationContext: { user: { id: string }; locationId: string; timeZone: string | null };
let resolveCalls: string[] = [];
let recorded: Array<{
  doctorId: string;
  minuteBucket: string;
  surface: string;
  clinicTimeZone: string;
}> = [];
let insertResult = true;

vi.mock("@/lib/auth/session", () => ({
  requireLocationContext: async () => locationContext,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }),
      },
    },
  }),
}));

vi.mock("@/lib/o1/runtime-authority", () => ({
  resolveRuntimeDoctorId: async (actorUserId: string) => {
    resolveCalls.push(actorUserId);
    return DOCTOR;
  },
  persistRuntimeEngagementMinute: async (input: {
    doctorId: string;
    minuteBucket: string;
    surface: string;
    clinicTimeZone: string;
  }) => {
    recorded.push({ ...input });
    return insertResult;
  },
}));

const { POST } = await import("@/app/api/engagement/route");
const { NextRequest } = await import("next/server");

async function beaconFrom(pathname: string) {
  const payload = buildEngagementPayload(pathname);
  expect(payload, `${pathname} must classify to a surface`).not.toBeNull();
  const request = new NextRequest("http://localhost:3200/api/engagement", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return POST(request);
}

beforeEach(() => {
  locationContext = {
    user: { id: ACTOR },
    locationId: LOCATION,
    timeZone: ZONE,
  };
  resolveCalls = [];
  recorded = [];
  insertResult = true;
});

describe("a real engagement request reaches the durable F-I2 writer", () => {
  it("a CONSULTATION beacon resolves the canonical Doctor and records one server minute", async () => {
    const response = await beaconFrom("/consultation/3f1c2b7a-1111-4222-8333-444455556666");
    expect(response.status).toBe(204);

    expect(resolveCalls).toEqual([ACTOR]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      doctorId: DOCTOR,
      surface: "CONSULTATION",
      clinicTimeZone: ZONE,
    });
    expect(recorded[0].minuteBucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  });

  it("a SETTINGS beacon records only the frozen settings surface", async () => {
    expect((await beaconFrom("/settings/profile")).status).toBe(204);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].surface).toBe("SETTINGS");
  });

  it("treats a duplicate canonical minute as idempotent success", async () => {
    insertResult = false;
    expect((await beaconFrom("/queue")).status).toBe(204);
    expect(recorded).toHaveLength(1);
  });

  it("never forwards browser path or route identifiers to the durable writer", async () => {
    await beaconFrom("/patients/3f1c2b7a-1111-4222-8333-444455556666/documents/lab-report.pdf");
    const wire = JSON.stringify(recorded[0]);
    expect(wire).not.toContain("3f1c2b7a");
    expect(wire).not.toContain("lab-report");
    expect(wire).not.toContain("/patients/");
    expect(Object.keys(recorded[0]).sort()).toEqual(
      ["clinicTimeZone", "doctorId", "minuteBucket", "surface"].sort(),
    );
  });

  it("rejects a body carrying anything beyond the frozen surface before authority lookup", async () => {
    const request = new NextRequest("http://localhost:3200/api/engagement", {
      method: "POST",
      body: JSON.stringify({ surface: "QUEUE", path: "/patients/3f1c2b7a" }),
    });
    expect((await POST(request)).status).toBe(400);
    expect(resolveCalls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it("fails closed when verified location context has no timezone", async () => {
    locationContext = { ...locationContext, timeZone: null };
    expect((await beaconFrom("/queue")).status).toBe(503);
    expect(resolveCalls).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });
});
