import "server-only";

import {
  acknowledgeRuntimeActivityReconciliation,
  acknowledgeRuntimeActivityReconciliationDay,
  finalizeRuntimeActivityMeasurementDay,
  getRuntimeActivityDayWatermark,
  getRuntimeActivityReconciliationContext,
  listRuntimeActivityReconciliationDoctors,
  persistRuntimeActivityContribution,
  readRuntimeActivityReconciliationMinutes,
  type ActivityDayWatermark,
  type ActivityReconciliationContext,
  type ActivityReconciliationDoctor,
  type ActivityReconciliationMinute,
} from "@/lib/o1/runtime-authority";
import { assertConformant, buildActivityContributions } from "./producer";
import {
  NON_FEATURE_SENTINEL,
  O1A_SOURCE_STREAM,
  type ActivityContribution,
} from "./ports";
import { isEngagementSurface } from "./surfaces";

const DOCTOR_PAGE_SIZE = 100;
const MINUTE_PAGE_SIZE = 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ActivityReconciliationDeps {
  getDayWatermark(periodDay: string): Promise<ActivityDayWatermark>;
  listDoctors(input: {
    periodDay: string;
    afterDoctorId: string | null;
    limit: number;
  }): Promise<ActivityReconciliationDoctor[]>;
  getContext(input: {
    doctorId: string;
    periodDay: string;
  }): Promise<ActivityReconciliationContext>;
  readMinutes(input: {
    doctorId: string;
    periodDay: string;
    generation: number;
    afterMinuteBucket: string | null;
    afterSurface: string | null;
    limit: number;
  }): Promise<ActivityReconciliationMinute[]>;
  persistContribution(row: ActivityContribution): Promise<void>;
  acknowledgeDoctor(input: {
    doctorId: string;
    periodDay: string;
    generation: number;
  }): Promise<void>;
  acknowledgeDay(input: {
    periodDay: string;
    observedGeneration: number;
    observedDoctorCount: number;
  }): Promise<void>;
  finalizeDay(input: { periodDay: string; sourceVersion: number }): Promise<void>;
}

const RUNTIME_DEPS: ActivityReconciliationDeps = {
  getDayWatermark: getRuntimeActivityDayWatermark,
  listDoctors: listRuntimeActivityReconciliationDoctors,
  getContext: getRuntimeActivityReconciliationContext,
  readMinutes: readRuntimeActivityReconciliationMinutes,
  persistContribution: persistRuntimeActivityContribution,
  acknowledgeDoctor: acknowledgeRuntimeActivityReconciliation,
  acknowledgeDay: acknowledgeRuntimeActivityReconciliationDay,
  finalizeDay: finalizeRuntimeActivityMeasurementDay,
};

function zeroProjection(doctorId: string, periodDay: string): ActivityContribution[] {
  return [
    {
      metricCode: "DOCTOR_ENGAGED_MINUTES_DAILY",
      doctorId,
      periodDay,
      featureCode: NON_FEATURE_SENTINEL,
      value: 0,
      sourceStream: O1A_SOURCE_STREAM,
      sourceVersion: 0,
    },
    {
      metricCode: "DOCTOR_SESSION_COUNT_DAILY",
      doctorId,
      periodDay,
      featureCode: NON_FEATURE_SENTINEL,
      value: 0,
      sourceStream: O1A_SOURCE_STREAM,
      sourceVersion: 0,
    },
    {
      metricCode: "DOCTOR_ACTIVE_DAY",
      doctorId,
      periodDay,
      featureCode: NON_FEATURE_SENTINEL,
      value: 0,
      sourceStream: O1A_SOURCE_STREAM,
      sourceVersion: 0,
    },
  ];
}

async function readExactMinuteSnapshot(
  doctorId: string,
  periodDay: string,
  generation: number,
  deps: ActivityReconciliationDeps,
) {
  const minutes: Array<{ minuteBucket: string; surface: ReturnType<typeof asSurface> }> = [];
  let afterMinuteBucket: string | null = null;
  let afterSurface: string | null = null;

  while (true) {
    const page = await deps.readMinutes({
      doctorId,
      periodDay,
      generation,
      afterMinuteBucket,
      afterSurface,
      limit: MINUTE_PAGE_SIZE,
    });

    for (const row of page) {
      minutes.push({ minuteBucket: row.minuteBucket, surface: asSurface(row.surface) });
    }

    if (page.length < MINUTE_PAGE_SIZE) break;
    const last = page.at(-1)!;
    afterMinuteBucket = last.minuteBucket;
    afterSurface = last.surface;
  }

  if (minutes.length !== generation) {
    throw new Error("O1F_ACTIVITY_EVIDENCE_COUNT_MOVED");
  }
  return minutes;
}

function asSurface(value: string) {
  if (!isEngagementSurface(value)) throw new Error("O1F_ACTIVITY_SURFACE_INVALID");
  return value;
}

export interface ActivityReconciliationSummary {
  periodDay: string;
  sourceVersion: number;
  doctorCount: number;
  evidenceRows: number;
}

/**
 * Reconcile and close one already-ended clinic-date label.
 *
 * No elapsed-time heuristic proves completeness. Every acknowledgement is tied
 * to the exact evidence generation observed from F-I2; any late unique minute
 * makes one of the generation checks fail and the run is safely retried.
 */
export async function runActivityReconciliationDay(
  periodDay: string,
  deps: ActivityReconciliationDeps = RUNTIME_DEPS,
): Promise<ActivityReconciliationSummary> {
  if (!DAY_RE.test(periodDay)) throw new Error("O1F_ACTIVITY_DAY_INVALID");

  const watermark = await deps.getDayWatermark(periodDay);
  let observedDoctors = 0;
  let evidenceRows = 0;
  let afterDoctorId: string | null = null;

  while (true) {
    const page = await deps.listDoctors({
      periodDay,
      afterDoctorId,
      limit: DOCTOR_PAGE_SIZE,
    });

    for (const listed of page) {
      const context = await deps.getContext({ doctorId: listed.doctorId, periodDay });
      if (context.evidenceGeneration !== listed.evidenceGeneration) {
        throw new Error("O1F_ACTIVITY_RECONCILIATION_GENERATION_MOVED");
      }
      if (context.retainedMinuteCount !== context.evidenceGeneration) {
        throw new Error("O1F_ACTIVITY_EVIDENCE_EXPIRED");
      }

      let rows: ActivityContribution[];
      if (context.evidenceGeneration === 0) {
        if (context.clinicTimeZone !== null) {
          throw new Error("O1F_ACTIVITY_ZERO_EVIDENCE_TIMEZONE_UNEXPECTED");
        }
        rows = zeroProjection(listed.doctorId, periodDay);
      } else {
        if (!context.clinicTimeZone) throw new Error("O1F_ACTIVITY_TIMEZONE_MISSING");
        const minutes = await readExactMinuteSnapshot(
          listed.doctorId,
          periodDay,
          context.evidenceGeneration,
          deps,
        );
        evidenceRows += minutes.length;
        rows = buildActivityContributions({
          doctorId: listed.doctorId,
          periodDay,
          minutes,
          timeZone: context.clinicTimeZone,
        });
        if (rows.some((row) => row.sourceVersion !== context.evidenceGeneration)) {
          throw new Error("O1F_ACTIVITY_PROJECTION_GENERATION_MISMATCH");
        }
      }

      assertConformant(rows);
      for (const row of rows) await deps.persistContribution(row);

      await deps.acknowledgeDoctor({
        doctorId: listed.doctorId,
        periodDay,
        generation: context.evidenceGeneration,
      });
      observedDoctors += 1;
    }

    if (page.length < DOCTOR_PAGE_SIZE) break;
    afterDoctorId = page.at(-1)!.doctorId;
  }

  if (observedDoctors !== watermark.eligibleDoctorCount) {
    throw new Error("O1F_ACTIVITY_DOCTOR_SET_MOVED");
  }

  await deps.acknowledgeDay({
    periodDay,
    observedGeneration: watermark.evidenceGeneration,
    observedDoctorCount: observedDoctors,
  });
  await deps.finalizeDay({
    periodDay,
    sourceVersion: watermark.evidenceGeneration,
  });

  return {
    periodDay,
    sourceVersion: watermark.evidenceGeneration,
    doctorCount: observedDoctors,
    evidenceRows,
  };
}
