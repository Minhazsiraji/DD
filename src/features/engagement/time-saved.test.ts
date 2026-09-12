import { describe, expect, it } from "vitest";
import {
  MIN_BASELINE_SAMPLE,
  aggregateTimeSaved,
  baselineConfidence,
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
    expect(r).toEqual({
      status: "INSUFFICIENT_EVIDENCE",
      reason,
      minutesSaved: null,
      confidence: "NOT_MEASURED",
    });
  });

  it("is exactly at the minimum sample, it estimates", () => {
    expect(
      estimateDailyTimeSaved(baseline({ sampleN: MIN_BASELINE_SAMPLE }), { medianSecondsPerRx: 1, eligibleEncounters: 1 }).status,
    ).toBe("ESTIMATED");
  });
});

/**
 * The frozen O1-A-R1 confidence ladder, asserted ON THE BOUNDARIES.
 *
 *   observed n >= 20   HIGH
 *   observed n 10..19  MEDIUM
 *   observed n 5..9    LOW
 *   observed n < 5     NOT_MEASURED
 *   SELF_REPORTED      LOW at every valid n
 *
 * Every tier edge is tested from both sides, because an off-by-one here
 * silently relabels a doctor's evidence.
 */
describe("baseline confidence — frozen boundaries", () => {
  it.each([
    [4, "NOT_MEASURED"],
    [5, "LOW"],
    [9, "LOW"],
    [10, "MEDIUM"],
    [19, "MEDIUM"],
    [20, "HIGH"],
  ] as const)("observed n=%i is %s", (sampleN, expected) => {
    expect(baselineConfidence(baseline({ sampleN }))).toBe(expected);
  });

  it("no baseline at all is NOT_MEASURED", () => {
    expect(baselineConfidence(null)).toBe("NOT_MEASURED");
  });

  /** The tier edges again, this time through a full estimate. */
  it.each([
    [4, "INSUFFICIENT_EVIDENCE", "NOT_MEASURED"],
    [5, "ESTIMATED", "LOW"],
    [9, "ESTIMATED", "LOW"],
    [10, "ESTIMATED", "MEDIUM"],
    [19, "ESTIMATED", "MEDIUM"],
    [20, "ESTIMATED", "HIGH"],
  ] as const)("an estimate at observed n=%i is %s/%s", (sampleN, status, confidence) => {
    const r = estimateDailyTimeSaved(baseline({ sampleN }), {
      medianSecondsPerRx: 200,
      eligibleEncounters: 12,
    });
    expect(r.status).toBe(status);
    expect(r.confidence).toBe(confidence);
  });

  /** n=5..19 is valid evidence. The old MIN of 20 rejected it outright. */
  it("does not reject a valid observed baseline of 5 to 19", () => {
    for (const sampleN of [5, 6, 9, 10, 15, 19]) {
      const r = estimateDailyTimeSaved(baseline({ sampleN }), {
        medianSecondsPerRx: 100,
        eligibleEncounters: 3,
      });
      expect(r.status, `n=${sampleN} must estimate`).toBe("ESTIMATED");
      expect(r.minutesSaved).not.toBeNull();
    }
  });
});

describe("a self-reported baseline is always LOW", () => {
  const selfReported = (sampleN: number) => baseline({ method: "SELF_REPORTED", sampleN });

  it.each([5, 9, 10, 19, 20, 100, 5000])("n=%i stays LOW", (sampleN) => {
    expect(baselineConfidence(selfReported(sampleN))).toBe("LOW");
  });

  it.each([5, 20, 400])("an estimate from a self-reported n=%i is LOW", (sampleN) => {
    const r = estimateDailyTimeSaved(selfReported(sampleN), {
      medianSecondsPerRx: 200,
      eligibleEncounters: 9,
    });
    expect(r.status === "ESTIMATED" && r.confidence).toBe("LOW");
  });

  /**
   * A huge DD sample is more evidence about DD, not about the recollection it
   * is compared against. It must not upgrade the tier.
   */
  it("is not upgraded by a large eligible-encounter count", () => {
    for (const eligibleEncounters of [1, 50, 5000]) {
      const r = estimateDailyTimeSaved(selfReported(900), { medianSecondsPerRx: 120, eligibleEncounters });
      expect(r.status === "ESTIMATED" && r.confidence).toBe("LOW");
    }
  });

  /** The same large DD sample does not upgrade a thin OBSERVED baseline either. */
  it("and a large DD sample does not upgrade a thin observed baseline", () => {
    const r = estimateDailyTimeSaved(baseline({ sampleN: 6 }), {
      medianSecondsPerRx: 120,
      eligibleEncounters: 5000,
    });
    expect(r.status === "ESTIMATED" && r.confidence).toBe("LOW");
  });

  /** Below the validity floor, the method cannot rescue it. */
  it("is NOT_MEASURED below the validity floor", () => {
    expect(baselineConfidence(selfReported(MIN_BASELINE_SAMPLE - 1))).toBe("NOT_MEASURED");
  });
});

describe("STANDARD is gone from the vocabulary", () => {
  it("never appears in any result", () => {
    const results = [
      estimateDailyTimeSaved(null, { medianSecondsPerRx: 1, eligibleEncounters: 1 }),
      estimateDailyTimeSaved(baseline({ sampleN: 4 }), { medianSecondsPerRx: 1, eligibleEncounters: 1 }),
      ...[5, 10, 20].map((sampleN) =>
        estimateDailyTimeSaved(baseline({ sampleN }), { medianSecondsPerRx: 1, eligibleEncounters: 1 }),
      ),
    ];
    for (const r of results) {
      expect(r.confidence).not.toBe("STANDARD");
      expect(["HIGH", "MEDIUM", "LOW", "NOT_MEASURED"]).toContain(r.confidence);
    }
  });
});

describe("period aggregation", () => {
  it("counts days without evidence instead of filling them in", () => {
    const days = [
      // HIGH: observed n=24.
      estimateDailyTimeSaved(baseline(), { medianSecondsPerRx: 180, eligibleEncounters: 6 }),
      estimateDailyTimeSaved(null, { medianSecondsPerRx: 180, eligibleEncounters: 6 }),
      // LOW: observed n=6, regardless of how many encounters were measured.
      estimateDailyTimeSaved(baseline({ sampleN: 6 }), { medianSecondsPerRx: 180, eligibleEncounters: 2 }),
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
