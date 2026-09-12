import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_LABEL,
  formatSignedMinutes,
  LIFECYCLE_LABEL,
  PARTICIPATION_LIFECYCLE,
  parseCohortDetailRow,
  parseConfidence,
  parseLifecycle,
  parsePilotStatusRow,
  parseServiceUsage,
  TIME_SAVED_CONFIDENCE,
} from "./contract";

describe("participation lifecycle is the frozen four", () => {
  it("has exactly the four states O1-F declares", () => {
    expect([...PARTICIPATION_LIFECYCLE]).toEqual(["INVITED", "ENROLLED", "COMPLETED", "WITHDRAWN"]);
  });

  it("has no invented engagement states", () => {
    for (const invented of ["ACTIVE", "PAUSED", "ONBOARDING", "INACTIVE", "DORMANT"]) {
      expect(parseLifecycle(invented), invented).toBeNull();
      expect(PARTICIPATION_LIFECYCLE).not.toContain(invented);
      expect(Object.keys(LIFECYCLE_LABEL)).not.toContain(invented);
    }
  });

  it("refuses anything outside the vocabulary rather than showing it as a status", () => {
    expect(parseLifecycle("enrolled")).toBeNull();
    expect(parseLifecycle(null)).toBeNull();
    expect(parseLifecycle(7)).toBeNull();
    expect(parseLifecycle("ENROLLED")).toBe("ENROLLED");
  });
});

describe("time-saved confidence is the frozen ladder", () => {
  it("is HIGH / MEDIUM / LOW / NOT_MEASURED and nothing else", () => {
    expect([...TIME_SAVED_CONFIDENCE]).toEqual(["HIGH", "MEDIUM", "LOW", "NOT_MEASURED"]);
  });

  it("has no STANDARD tier", () => {
    expect(parseConfidence("STANDARD")).toBeNull();
    expect(TIME_SAVED_CONFIDENCE).not.toContain("STANDARD");
    expect(Object.keys(CONFIDENCE_LABEL)).not.toContain("STANDARD");
    expect(JSON.stringify(CONFIDENCE_LABEL)).not.toMatch(/standard/i);
  });

  it("keeps a negative estimate negative — DD being slower is a finding", () => {
    expect(formatSignedMinutes(-12)).toBe("-12 min");
    expect(formatSignedMinutes(-0.6)).toBe("-1 min");
    expect(formatSignedMinutes(12)).toBe("+12 min");
    expect(formatSignedMinutes(0)).toBe("0 min");
    expect(formatSignedMinutes(-1200)).toBe("-1,200 min");
  });
});

describe("owner_pilot_status rows", () => {
  it("maps every counter through the token vocabulary", () => {
    const parsed = parsePilotStatusRow({
      cohort_code: "PILOT_A",
      invited_count: "9",
      enrolled_count: "7",
      completed_count: "0",
      withdrawn_count: "UNAVAILABLE",
      consented_count: "NOT_MEASURED",
      active_doctor_count: "INSUFFICIENT_COHORT",
    });

    expect(parsed?.cohortCode).toBe("PILOT_A");
    expect(parsed?.counts.invited).toEqual({ state: "measured", value: 9 });
    expect(parsed?.counts.completed).toEqual({ state: "measured", value: 0 });
    expect(parsed?.counts.withdrawn.state).toBe("unavailable");
    expect(parsed?.counts.consented.state).toBe("not-measured");
    expect(parsed?.counts.activeDoctors).toEqual({ state: "insufficient-cohort" });
  });

  it("drops a row with no cohort code rather than inventing one", () => {
    expect(parsePilotStatusRow({ invited_count: "3" })).toBeNull();
  });
});

describe("owner_pilot_cohort_detail rows", () => {
  it("carries the participation handle and no doctor identity", () => {
    const row = parseCohortDetailRow({
      participation_id: "6f7c1f52-0a0a-4a4a-9c1e-2b2b2b2b2b2b",
      status: "ENROLLED",
      enrolled_on: "2026-08-01",
      measurement_status: "OK",
      engaged_minutes: 120,
      active_days: 4,
      session_count: 9,
      feature_touch_count: 31,
    });

    expect(row?.participationId).toBe("6f7c1f52-0a0a-4a4a-9c1e-2b2b2b2b2b2b");
    expect(row?.lifecycle).toBe("ENROLLED");
    expect(row?.metrics.engagedMinutes).toEqual({ state: "measured", value: 120 });
    expect(Object.keys(row ?? {})).not.toContain("doctorId");
    expect(JSON.stringify(row)).not.toMatch(/doctor_id|doctorId/);
  });

  it("reports a withdrawn participation as unavailable, not as zeroes", () => {
    const row = parseCohortDetailRow({
      participation_id: "aaaaaaaa-0000-0000-0000-000000000000",
      status: "WITHDRAWN",
      enrolled_on: "2026-08-01",
      measurement_status: "UNAVAILABLE",
      engaged_minutes: null,
      active_days: null,
      session_count: null,
      feature_touch_count: null,
    });

    expect(row?.lifecycle).toBe("WITHDRAWN");
    for (const m of Object.values(row?.metrics ?? {})) expect(m.state).toBe("unavailable");
  });

  it("reports a null metric under OK as not measured, not as zero", () => {
    const row = parseCohortDetailRow({
      participation_id: "bbbbbbbb-0000-0000-0000-000000000000",
      status: "ENROLLED",
      measurement_status: "OK",
      engaged_minutes: null,
      active_days: 0,
      session_count: null,
      feature_touch_count: null,
    });

    expect(row?.metrics.engagedMinutes.state).toBe("not-measured");
    expect(row?.metrics.activeDays).toEqual({ state: "measured", value: 0 });
  });
});

describe("owner_service_usage_summary rows", () => {
  it("keeps provider and model dimensions rather than collapsing them", () => {
    const usage = parseServiceUsage([
      {
        status: "OK",
        provider_id: "openai",
        model_id: "gpt-4o-mini",
        service_kind: "AI_PROPOSAL",
        unit: "INPUT_TOKENS",
        quantity_total: 1200,
        event_count: 6,
        estimated_cost_minor: "0.0300000000",
        currency_code: "USD",
      },
      {
        status: "OK",
        provider_id: "terra",
        model_id: "stt-1",
        service_kind: "VOICE_STT",
        unit: "AUDIO_MILLIS",
        quantity_total: 90000,
        event_count: 3,
        estimated_cost_minor: null,
        currency_code: "USD",
      },
    ]);

    expect(usage.status).toBe("OK");
    expect(usage.rows).toHaveLength(2);
    expect(usage.rows[0].providerId).toBe("openai");
    expect(usage.rows[0].modelId).toBe("gpt-4o-mini");
    expect(usage.rows[1].costMinor).toBeNull();
    expect(usage.hasSuppressedBuckets).toBe(false);
  });

  it("records F's suppression marker instead of dropping it silently", () => {
    const usage = parseServiceUsage([
      {
        status: "OK",
        provider_id: "openai",
        model_id: "gpt-4o-mini",
        service_kind: "AI_PROPOSAL",
        unit: "OUTPUT_TOKENS",
        quantity_total: 10,
        event_count: 1,
        estimated_cost_minor: "1",
        currency_code: "USD",
      },
      { status: "INSUFFICIENT_COHORT" },
    ]);

    expect(usage.hasSuppressedBuckets).toBe(true);
    expect(usage.rows).toHaveLength(1);
  });

  it("carries a whole-result verdict when F published no buckets", () => {
    expect(parseServiceUsage([{ status: "INSUFFICIENT_COHORT" }]).status).toBe("INSUFFICIENT_COHORT");
    expect(parseServiceUsage([{ status: "NOT_MEASURED" }]).status).toBe("NOT_MEASURED");
    expect(parseServiceUsage([{ status: "UNAVAILABLE" }]).status).toBe("UNAVAILABLE");
    expect(parseServiceUsage([]).status).toBe("UNAVAILABLE");
  });

  it("treats F's all-null OK row as a measured, complete nothing", () => {
    const usage = parseServiceUsage([
      {
        status: "OK",
        provider_id: null,
        model_id: null,
        service_kind: null,
        unit: null,
        quantity_total: 0,
        event_count: 0,
        estimated_cost_minor: 0,
        currency_code: null,
      },
    ]);
    expect(usage.status).toBe("OK");
    expect(usage.rows).toHaveLength(0);
  });
});
