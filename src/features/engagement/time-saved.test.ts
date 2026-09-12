import { describe, expect, it } from "vitest";
import {
  LOW_CONFIDENCE_ELIGIBLE_ENCOUNTERS,
  MIN_BASELINE_SAMPLE,
  aggregateTimeSaved,
  estimateDailyTimeSaved,
  type ManualBaseline,
} from "./time-saved";

const baseline = (over: Partial<ManualBaseline> = {}): ManualBaseline => ({
  secondsPerRx: 300,
  method: "OBSERVED_TIME_MOTION",
  sampleN: 24,
  ...over,
});

describe("time saved is signed and never clamped", () => {
  it("reports a saving when DD is faster", () => {
    const r = estimateDailyTimeSaved(baseline(), { medianSecondsPerRx: 180, eligibleEncounters: 10 });
    expect(r.status).toBe("ESTIMATED");
    if (r.status !== "ESTIMATED") return;
    expect(r.signedDeltaSecondsPerRx).toBe(120);
    expect(r.minutesSaved).toBe(20);
  });

  /** O1-A-R1 decision 6: the dashboard must be able to say DD was slower. */
  it("reports a NEGATIVE result when DD is slower — nothing is clamped to zero", () => {
    const r = estimateDailyTimeSaved(baseline(), { medianSecondsPerRx: 360, eligibleEncounters: 10 });
    expect(r.status).toBe("ESTIMATED");
    if (r.status !== "ESTIMATED") return;
    expect(r.signedDeltaSecondsPerRx).toBe(-60);
    expect(r.minutesSaved).toBe(-10);
  });

  it("a slow day subtracts from the period", () => {
    const fast = estimateDailyTimeSaved(baseline(), { medianSecondsPerRx: 180, eligibleEncounters: 10 });
    const slow = estimateDailyTimeSaved(baseline(), { medianSecondsPerRx: 420, eligibleEncounters: 10 });
    expect(aggregateTimeSaved([fast, slow], false).hoursSaved).toBeCloseTo((20 - 20) / 60);
  });

  it("carries the baseline method and sample size with every estimate", () => {
    const r = estimateDailyTimeSaved(baseline({ method: "SELF_REPORTED", sampleN: 31 }), {
      medianSecondsPerRx: 200,
      eligibleEncounters: 8,
    });
    expect(r).toMatchObject({ baselineMethod: "SELF_REPORTED", baselineSampleN: 31, eligibleEncounters: 8 });
  });
});

describe("NULL, never a guess, when evidence is insufficient", () => {
  it.each([
    ["no baseline", null, { medianSecondsPerRx: 180, eligibleEncounters: 10 }, "NO_BASELINE"],
    ["sample too small", baseline({ sampleN: MIN_BASELINE_SAMPLE - 1 }), { medianSecondsPerRx: 180, eligibleEncounters: 10 }, "BASELINE_SAMPLE_TOO_SMALL"],
    ["no eligible encounters", baseline(), { medianSecondsPerRx: 180, eligibleEncounters: 0 }, "NO_ELIGIBLE_ENCOUNTERS"],
    ["no measured median", baseline(), { medianSecondsPerRx: null, eligibleEncounters: 4 }, "NO_MEASURED_MEDIAN"],
    ["negative baseline", baseline({ secondsPerRx: -1 }), { medianSecondsPerRx: 180, eligibleEncounters: 4 }, "INVALID_INPUT"],
    ["NaN median", baseline(), { medianSecondsPerRx: Number.NaN, eligibleEncounters: 4 }, "INVALID_INPUT"],
    ["fractional count", baseline(), { medianSecondsPerRx: 180, eligibleEncounters: 2.5 }, "INVALID_INPUT"],
  ] as const)("%s", (_name, b, measured, reason) => {
    const r = estimateDailyTimeSaved(b, measured);
    expect(r).toEqual({ status: "INSUFFICIENT_EVIDENCE", reason, minutesSaved: null });
  });

  it("is exactly at the minimum sample, it estimates", () => {
    expect(
      estimateDailyTimeSaved(baseline({ sampleN: MIN_BASELINE_SAMPLE }), { medianSecondsPerRx: 1, eligibleEncounters: 1 }).status,
    ).toBe("ESTIMATED");
  });
});

describe("confidence", () => {
  it("is LOW below the eligible-encounter floor and STANDARD at it", () => {
    const low = estimateDailyTimeSaved(baseline(), {
      medianSecondsPerRx: 200,
      eligibleEncounters: LOW_CONFIDENCE_ELIGIBLE_ENCOUNTERS - 1,
    });
    const std = estimateDailyTimeSaved(baseline(), {
      medianSecondsPerRx: 200,
      eligibleEncounters: LOW_CONFIDENCE_ELIGIBLE_ENCOUNTERS,
    });
    expect(low.status === "ESTIMATED" && low.confidence).toBe("LOW");
    expect(std.status === "ESTIMATED" && std.confidence).toBe("STANDARD");
  });
});

describe("period aggregation", () => {
  it("counts days without evidence instead of filling them in", () => {
    const days = [
      estimateDailyTimeSaved(baseline(), { medianSecondsPerRx: 180, eligibleEncounters: 6 }),
      estimateDailyTimeSaved(null, { medianSecondsPerRx: 180, eligibleEncounters: 6 }),
      estimateDailyTimeSaved(baseline(), { medianSecondsPerRx: 180, eligibleEncounters: 2 }),
    ];
    const p = aggregateTimeSaved(days, true);
    expect(p.daysEstimated).toBe(2);
    expect(p.daysInsufficient).toBe(1);
    expect(p.daysLowConfidence).toBe(1);
    expect(p.partialPeriod).toBe(true);
    expect(p.hoursSaved).toBeCloseTo((12 + 4) / 60);
  });

  it("is NULL, not zero, when no day had an estimate", () => {
    expect(aggregateTimeSaved([estimateDailyTimeSaved(null, { medianSecondsPerRx: 1, eligibleEncounters: 1 })], false).hoursSaved).toBeNull();
    expect(aggregateTimeSaved([], false).hoursSaved).toBeNull();
  });
});
