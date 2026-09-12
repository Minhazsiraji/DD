/**
 * Estimated time saved — manual Rx baseline versus the measured DD workflow.
 *
 * Pure arithmetic over AGGREGATE inputs. It never sees an encounter, a
 * prescription or a patient: the eligible-cohort median and count arrive
 * already computed server-side, and the baseline arrives from the pilot
 * participation control plane (Loop F).
 *
 * THREE RULES, all frozen in O1-A-R1:
 *
 *   SIGNED. `baseline − measured` keeps its sign. A negative result means DD
 *   was slower than the doctor's manual workflow, and the dashboard must be
 *   able to say exactly that. Nothing here clamps to zero.
 *
 *   LIKE FOR LIKE. The baseline is a PRESCRIPTION baseline, so it is compared
 *   only with the eligible cohort — encounters that were COMPLETED and
 *   produced at least one FINALIZED prescription. Consultations without an Rx
 *   are real consultations, but they are not the workflow being timed.
 *
 *   NULL, NEVER A GUESS. No baseline, too small a sample, or no eligible
 *   encounters gives `null` with a reason. Not zero, and not an estimate
 *   dressed up as one.
 *
 * CONFIDENCE COMES FROM THE BASELINE, NOT FROM DD's SAMPLE. Frozen:
 *
 *   observed n >= 20                  HIGH
 *   observed n 10..19                 MEDIUM
 *   observed n 5..9                   LOW
 *   observed n < 5, or no baseline    NOT_MEASURED
 *   SELF_REPORTED (any valid n)       LOW, always
 *
 * A self-reported baseline is a recollection. Measuring a great many DD
 * encounters against it makes the COMPARISON no better, so `eligibleEncounters`
 * is carried as evidence metadata and is deliberately given no vote in
 * confidence — it cannot lift SELF_REPORTED above LOW, and it cannot lift a
 * thin observed baseline either.
 */

/**
 * Fewest baseline observations that can be compared at all. Below this the
 * answer is NOT_MEASURED — an n of 4 is an anecdote, not a baseline.
 */
export const MIN_BASELINE_SAMPLE = 5;

/** At or above this many observations, an observed baseline is MEDIUM. */
export const MEDIUM_BASELINE_SAMPLE = 10;

/** At or above this many observations, an observed baseline is HIGH. */
export const HIGH_BASELINE_SAMPLE = 20;

export type BaselineMethod = "OBSERVED_TIME_MOTION" | "SELF_REPORTED";

/**
 * The only confidence vocabulary. There is no STANDARD tier — a result is
 * either measured at one of three strengths, or it is NOT_MEASURED.
 */
export type TimeSavedConfidence = "HIGH" | "MEDIUM" | "LOW" | "NOT_MEASURED";

export interface ManualBaseline {
  secondsPerRx: number;
  method: BaselineMethod;
  sampleN: number;
}

export interface MeasuredDdWorkflow {
  /** Median seconds, encounter start → Rx finalized, over the eligible cohort. */
  medianSecondsPerRx: number | null;
  /** Encounters that were COMPLETED and produced ≥1 FINALIZED prescription. */
  eligibleEncounters: number;
}

export type InsufficientReason =
  | "NO_BASELINE"
  | "BASELINE_SAMPLE_TOO_SMALL"
  | "NO_MEASURED_MEDIAN"
  | "NO_ELIGIBLE_ENCOUNTERS"
  | "INVALID_INPUT";

export type TimeSavedResult =
  | {
      status: "INSUFFICIENT_EVIDENCE";
      reason: InsufficientReason;
      minutesSaved: null;
      confidence: "NOT_MEASURED";
    }
  | {
      status: "ESTIMATED";
      /** Positive: DD was faster. Negative: DD was slower. Never clamped. */
      signedDeltaSecondsPerRx: number;
      /** May be negative. */
      minutesSaved: number;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      baselineMethod: BaselineMethod;
      baselineSampleN: number;
      /** Evidence metadata only. It never influences `confidence`. */
      eligibleEncounters: number;
    };

const insufficient = (reason: InsufficientReason): TimeSavedResult => ({
  status: "INSUFFICIENT_EVIDENCE",
  reason,
  minutesSaved: null,
  confidence: "NOT_MEASURED",
});

const isFiniteNonNegative = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * Confidence in the BASELINE — the whole comparison is only as good as this.
 *
 * Exported so the boundaries are testable directly rather than only through a
 * full estimate, and so a presenter can label a baseline before any day of DD
 * data exists.
 *
 * The method is checked BEFORE the observed-n tiers, which is what pins a
 * self-reported baseline to LOW no matter how large its n is.
 */
export function baselineConfidence(baseline: ManualBaseline | null): TimeSavedConfidence {
  if (!baseline) return "NOT_MEASURED";
  if (!Number.isInteger(baseline.sampleN) || baseline.sampleN < MIN_BASELINE_SAMPLE) {
    return "NOT_MEASURED";
  }
  if (baseline.method === "SELF_REPORTED") return "LOW";
  if (baseline.sampleN >= HIGH_BASELINE_SAMPLE) return "HIGH";
  if (baseline.sampleN >= MEDIUM_BASELINE_SAMPLE) return "MEDIUM";
  return "LOW";
}

/** One day, one doctor. */
export function estimateDailyTimeSaved(
  baseline: ManualBaseline | null,
  measured: MeasuredDdWorkflow,
): TimeSavedResult {
  if (!baseline) return insufficient("NO_BASELINE");
  if (
    !isFiniteNonNegative(baseline.secondsPerRx) ||
    !Number.isInteger(baseline.sampleN) ||
    baseline.sampleN < 0
  ) {
    return insufficient("INVALID_INPUT");
  }
  if (baseline.sampleN < MIN_BASELINE_SAMPLE) return insufficient("BASELINE_SAMPLE_TOO_SMALL");
  if (!Number.isInteger(measured.eligibleEncounters) || measured.eligibleEncounters < 0) {
    return insufficient("INVALID_INPUT");
  }
  if (measured.eligibleEncounters === 0) return insufficient("NO_ELIGIBLE_ENCOUNTERS");
  if (measured.medianSecondsPerRx === null) return insufficient("NO_MEASURED_MEDIAN");
  if (!isFiniteNonNegative(measured.medianSecondsPerRx)) return insufficient("INVALID_INPUT");

  const signedDeltaSecondsPerRx = baseline.secondsPerRx - measured.medianSecondsPerRx;
  const minutesSaved = (signedDeltaSecondsPerRx * measured.eligibleEncounters) / 60;

  /**
   * The validity gate above already rejected everything NOT_MEASURED, so the
   * baseline here can only be HIGH, MEDIUM or LOW. The assertion keeps that
   * invariant visible instead of widening the estimate's union.
   */
  const confidence = baselineConfidence(baseline);
  if (confidence === "NOT_MEASURED") return insufficient("BASELINE_SAMPLE_TOO_SMALL");

  return {
    status: "ESTIMATED",
    signedDeltaSecondsPerRx,
    minutesSaved,
    confidence,
    baselineMethod: baseline.method,
    baselineSampleN: baseline.sampleN,
    eligibleEncounters: measured.eligibleEncounters,
  };
}

export interface PeriodTimeSaved {
  /** Signed sum over days with an estimate. Null when no day had one. */
  hoursSaved: number | null;
  daysEstimated: number;
  daysInsufficient: number;
  daysLowConfidence: number;
  /** True when the period is not yet complete — never extrapolate it. */
  partialPeriod: boolean;
}

/**
 * Sum daily estimates into a period (e.g. a calendar month).
 *
 * Signed throughout: a slow week subtracts. Days without evidence are counted
 * and reported, never filled in, and a partial period is flagged rather than
 * projected to a full one — "so far this month", not "this month".
 */
export function aggregateTimeSaved(
  daily: readonly TimeSavedResult[],
  partialPeriod: boolean,
): PeriodTimeSaved {
  let minutes = 0;
  let daysEstimated = 0;
  let daysInsufficient = 0;
  let daysLowConfidence = 0;
  for (const day of daily) {
    if (day.status === "ESTIMATED") {
      minutes += day.minutesSaved;
      daysEstimated += 1;
      if (day.confidence === "LOW") daysLowConfidence += 1;
    } else {
      daysInsufficient += 1;
    }
  }
  return {
    hoursSaved: daysEstimated === 0 ? null : minutes / 60,
    daysEstimated,
    daysInsufficient,
    daysLowConfidence,
    partialPeriod,
  };
}
