import { describe, expect, it } from "vitest";
import type { EngagedMinute } from "./engagement";
import {
  ACTIVITY_METRIC_CODES,
  NON_FEATURE_SENTINEL,
  O1A_SOURCE_STREAM,
} from "./ports";
import { assertConformant, buildActivityContributions, snapshotVersion } from "./producer";
import { A_FEATURE_CODES } from "./surfaces";

/**
 * Conformance with O1-F's `activity_contributions` contract
 * (`supabase/policies/0047_o1_owner_analytics_authority.sql` §4).
 *
 * Every assertion here mirrors a database constraint. If one of these fails,
 * the privileged RPC would have been rejected in production instead.
 */

const DOCTOR = "11111111-2222-4333-8444-555555555555";
const DAY = "2026-09-10";

/** 09:00 Dhaka onwards, so the clinic day is unambiguous. */
const at = (minute: number, surface: EngagedMinute["surface"] = "CONSULTATION"): EngagedMinute => ({
  minuteBucket: new Date(Date.UTC(2026, 8, 10, 3, minute)).toISOString(),
  surface,
});

const build = (minutes: readonly EngagedMinute[]) =>
  buildActivityContributions({ doctorId: DOCTOR, periodDay: DAY, minutes, timeZone: "Asia/Dhaka" });

const row = (rows: ReturnType<typeof build>, code: string, feature?: string) =>
  rows.find((r) => r.metricCode === code && (feature === undefined || r.featureCode === feature));

describe("the four O1-F metrics, and only those", () => {
  /**
   * The whole-day three are unconditional, and a feature touch accompanies
   * them for every mapped surface with a minute. There is no configuration
   * under which the feature row disappears.
   */
  it("emits the whole-day three plus a touch for the surface used", () => {
    const rows = build([at(0), at(1)]);
    expect(rows.map((r) => r.metricCode).sort()).toEqual([
      "DOCTOR_ACTIVE_DAY",
      "DOCTOR_ENGAGED_MINUTES_DAILY",
      "DOCTOR_FEATURE_TOUCH_DAILY",
      "DOCTOR_SESSION_COUNT_DAILY",
    ]);
    expect(row(rows, "DOCTOR_FEATURE_TOUCH_DAILY")!.featureCode).toBe("consultation");
  });

  it("uses only metric codes O1-F's CHECK constraint allows", () => {
    const allowed = new Set<string>(ACTIVITY_METRIC_CODES);
    for (const r of build([at(0), at(1, "SETTINGS")])) expect(allowed.has(r.metricCode)).toBe(true);
  });

  it("stamps O1-A's source stream on every row", () => {
    for (const r of build([at(0)])) expect(r.sourceStream).toBe(O1A_SOURCE_STREAM);
  });
});

describe("the feature sentinel rules are O1-F's CHECK constraint", () => {
  it("uses '*' on the three whole-day metrics", () => {
    for (const code of ["DOCTOR_ENGAGED_MINUTES_DAILY", "DOCTOR_SESSION_COUNT_DAILY", "DOCTOR_ACTIVE_DAY"]) {
      expect(row(build([at(0)]), code)!.featureCode).toBe(NON_FEATURE_SENTINEL);
    }
  });

  it("never uses '*' on the per-feature metric", () => {
    const touches = build([at(0), at(1, "QUEUE")]).filter((r) => r.metricCode === "DOCTOR_FEATURE_TOUCH_DAILY");
    expect(touches.length).toBeGreaterThan(0);
    for (const t of touches) expect(t.featureCode).not.toBe(NON_FEATURE_SENTINEL);
  });

  /**
   * THE FROZEN SEVEN, each proven to produce a row.
   *
   * Previously the producer took a "registered codes" set that defaulted to
   * empty, and the real request path never supplied one — so these rows existed
   * only in tests. The vocabulary is now a spec constant, so this list IS the
   * behaviour.
   */
  it.each([
    ["DASHBOARD", "dashboard"],
    ["PATIENTS", "patients"],
    ["CONSULTATION", "consultation"],
    ["PRESCRIPTION", "prescription"],
    ["APPOINTMENTS", "appointments"],
    ["QUEUE", "queue"],
    ["SETTINGS", "settings"],
  ] as const)("%s deterministically produces a %s feature touch", (surface, code) => {
    const rows = build([at(0, surface), at(1, surface)]);
    expect(row(rows, "DOCTOR_FEATURE_TOUCH_DAILY", code)).toMatchObject({ featureCode: code, value: 2 });
  });

  /** OWNER is platform administration, not a Doctor feature. */
  it("produces no feature touch for OWNER", () => {
    const rows = build([at(0, "OWNER")]);
    expect(rows.some((r) => r.metricCode === "DOCTOR_FEATURE_TOUCH_DAILY")).toBe(false);
  });

  it("covers exactly the frozen seven and nothing else", () => {
    expect([...A_FEATURE_CODES].sort()).toEqual([
      "appointments", "consultation", "dashboard", "patients", "prescription", "queue", "settings",
    ]);
    expect(A_FEATURE_CODES.has("owner")).toBe(false);
  });

  it("emits registry-shaped codes only", () => {
    for (const t of build([at(0), at(1, "SETTINGS")]).filter((r) => r.metricCode === "DOCTOR_FEATURE_TOUCH_DAILY")) {
      expect(t.featureCode).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
    }
  });
});

describe("the values are whole-day totals", () => {
  it("counts distinct qualifying minutes, not requests", () => {
    const rows = build([at(0), at(0), at(1), at(2)]);
    expect(row(rows, "DOCTOR_ENGAGED_MINUTES_DAILY")!.value).toBe(3);
  });

  it("counts sessions split by the idle gap", () => {
    const rows = build([at(0), at(1), at(30), at(31)]);
    expect(row(rows, "DOCTOR_SESSION_COUNT_DAILY")!.value).toBe(2);
  });

  it("reports the active day as 1 or 0, never a count", () => {
    expect(row(build([at(0), at(1), at(2)]), "DOCTOR_ACTIVE_DAY")!.value).toBe(1);
    expect(row(build([at(0, "SETTINGS")]), "DOCTOR_ACTIVE_DAY")!.value).toBe(0);
  });

  /** SETTINGS is recorded as a feature touch but can never make a day active. */
  it("records settings as a feature touch with zero engaged minutes", () => {
    const rows = build([at(0, "SETTINGS"), at(1, "SETTINGS")]);
    expect(row(rows, "DOCTOR_ENGAGED_MINUTES_DAILY")!.value).toBe(0);
    expect(row(rows, "DOCTOR_ACTIVE_DAY")!.value).toBe(0);
    expect(row(rows, "DOCTOR_SESSION_COUNT_DAILY")!.value).toBe(0);
    expect(row(rows, "DOCTOR_FEATURE_TOUCH_DAILY", "settings")!.value).toBe(2);
  });

  it("only counts minutes belonging to the day being produced", () => {
    // 18:30 UTC is 00:30 Dhaka the NEXT day, so it belongs to 2026-09-11.
    const nextDay: EngagedMinute = { minuteBucket: "2026-09-10T18:30:00.000Z", surface: "QUEUE" };
    const rows = build([at(0), nextDay]);
    expect(row(rows, "DOCTOR_ENGAGED_MINUTES_DAILY")!.value).toBe(1);
  });

  it("never emits a negative value, and caps a day at 1440 minutes", () => {
    const many = Array.from({ length: 1500 }, (_, i) => ({
      minuteBucket: new Date(Date.UTC(2026, 8, 9, 18, 30 + i)).toISOString(),
      surface: "CONSULTATION" as const,
    }));
    for (const r of buildActivityContributions({ doctorId: DOCTOR, periodDay: DAY, minutes: many, timeZone: "Asia/Dhaka" })) {
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(1440);
    }
  });
});

describe("source_version rises with the snapshot, not with a clock", () => {
  /**
   * O1-F upserts only when source_version INCREASES. The store is append-only,
   * so snapshot size is monotonic non-decreasing — a timestamp would let clock
   * skew between instances discard a fresher total.
   */
  it("grows as the day accumulates", () => {
    expect(snapshotVersion([])).toBe(0);
    expect(snapshotVersion([at(0)])).toBe(1);
    expect(snapshotVersion([at(0), at(1)])).toBe(2);
  });

  it("is identical on every row of one snapshot", () => {
    const rows = build([at(0), at(1, "QUEUE")]);
    expect(new Set(rows.map((r) => r.sourceVersion)).size).toBe(1);
  });

  it("does not fall when a non-qualifying minute arrives", () => {
    const before = build([at(0)])[0]!.sourceVersion;
    const after = build([at(0), at(1, "SETTINGS")])[0]!.sourceVersion;
    expect(after).toBeGreaterThan(before);
  });
});

describe("conformance guard", () => {
  it("passes rows the producer builds", () => {
    expect(() => assertConformant(build([at(0), at(1, "SETTINGS")]))).not.toThrow();
  });

  it.each([
    ["an unknown metric", { metricCode: "DOCTOR_MOOD_DAILY" }, /not in the O1-F contract/],
    ["a foreign source stream", { sourceStream: "SOMETHING_ELSE" }, /source_stream/],
    ["a negative value", { value: -1 }, /non-negative/],
    ["a fractional value", { value: 1.5 }, /non-negative/],
    ["a timestamp as the period day", { periodDay: "2026-09-10T04:00:00.000Z" }, /never a timestamp/],
    ["the sentinel on the feature metric", { metricCode: "DOCTOR_FEATURE_TOUCH_DAILY", featureCode: "*" }, /must not use/],
    ["a real code on a whole-day metric", { featureCode: "queue" }, /must use the '\*' sentinel/],
    ["an upper-case feature code", { metricCode: "DOCTOR_FEATURE_TOUCH_DAILY", featureCode: "Queue" }, /registry-shaped/],
  ])("refuses %s", (_label, patch, message) => {
    const rows = [{ ...build([at(0)])[0]!, ...patch }] as Parameters<typeof assertConformant>[0];
    expect(() => assertConformant(rows)).toThrow(message as RegExp);
  });
});
