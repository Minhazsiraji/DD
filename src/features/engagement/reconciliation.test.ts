import { describe, expect, it, vi } from "vitest";
import {
  runActivityReconciliationDay,
  type ActivityReconciliationDeps,
} from "./reconciliation";
import type { ActivityContribution } from "./ports";

const DOCTOR_ID = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-09-13";

function makeDeps(overrides: Partial<ActivityReconciliationDeps> = {}) {
  const persisted: ActivityContribution[] = [];
  const deps: ActivityReconciliationDeps = {
    getDayWatermark: vi.fn(async () => ({ evidenceGeneration: 2, eligibleDoctorCount: 1 })),
    listDoctors: vi.fn(async ({ afterDoctorId }) =>
      afterDoctorId
        ? []
        : [
            {
              doctorId: DOCTOR_ID,
              evidenceGeneration: 2,
              reconciledGeneration: 0,
              clinicTimeZone: "Asia/Dhaka",
              hasEvidence: true,
            },
          ],
    ),
    getContext: vi.fn(async () => ({
      evidenceGeneration: 2,
      reconciledGeneration: 0,
      clinicTimeZone: "Asia/Dhaka",
      retainedMinuteCount: 2,
    })),
    readMinutes: vi.fn(async () => [
      { minuteBucket: "2026-09-13T04:00:00.000Z", surface: "CONSULTATION" },
      { minuteBucket: "2026-09-13T04:00:00.000Z", surface: "PRESCRIPTION" },
    ]),
    persistContribution: vi.fn(async (row) => {
      persisted.push(row);
    }),
    acknowledgeDoctor: vi.fn(async () => undefined),
    acknowledgeDay: vi.fn(async () => undefined),
    finalizeDay: vi.fn(async () => undefined),
    ...overrides,
  };
  return { deps, persisted };
}

describe("O1 activity reconciliation", () => {
  it("projects the exact evidence generation, acknowledges Doctor/day, then finalizes", async () => {
    const { deps, persisted } = makeDeps();

    const result = await runActivityReconciliationDay(DAY, deps);

    expect(result).toEqual({
      periodDay: DAY,
      sourceVersion: 2,
      doctorCount: 1,
      evidenceRows: 2,
    });
    expect(persisted.map((row) => [row.metricCode, row.featureCode, row.value])).toEqual([
      ["DOCTOR_ENGAGED_MINUTES_DAILY", "*", 1],
      ["DOCTOR_SESSION_COUNT_DAILY", "*", 1],
      ["DOCTOR_ACTIVE_DAY", "*", 1],
      ["DOCTOR_FEATURE_TOUCH_DAILY", "consultation", 1],
      ["DOCTOR_FEATURE_TOUCH_DAILY", "prescription", 1],
    ]);
    expect(persisted.every((row) => row.sourceVersion === 2)).toBe(true);
    expect(deps.acknowledgeDoctor).toHaveBeenCalledWith({
      doctorId: DOCTOR_ID,
      periodDay: DAY,
      generation: 2,
    });
    expect(deps.acknowledgeDay).toHaveBeenCalledWith({
      periodDay: DAY,
      observedGeneration: 2,
      observedDoctorCount: 1,
    });
    expect(deps.finalizeDay).toHaveBeenCalledWith({ periodDay: DAY, sourceVersion: 2 });
  });

  it("writes truthful zero core rows without inventing a timezone", async () => {
    const { deps, persisted } = makeDeps({
      getDayWatermark: vi.fn(async () => ({ evidenceGeneration: 0, eligibleDoctorCount: 1 })),
      listDoctors: vi.fn(async ({ afterDoctorId }) =>
        afterDoctorId
          ? []
          : [
              {
                doctorId: DOCTOR_ID,
                evidenceGeneration: 0,
                reconciledGeneration: 0,
                clinicTimeZone: null,
                hasEvidence: false,
              },
            ],
      ),
      getContext: vi.fn(async () => ({
        evidenceGeneration: 0,
        reconciledGeneration: 0,
        clinicTimeZone: null,
        retainedMinuteCount: 0,
      })),
      readMinutes: vi.fn(async () => {
        throw new Error("zero evidence must not read minute pages");
      }),
    });

    const result = await runActivityReconciliationDay(DAY, deps);

    expect(result.sourceVersion).toBe(0);
    expect(result.evidenceRows).toBe(0);
    expect(persisted).toHaveLength(3);
    expect(persisted.map((row) => row.metricCode)).toEqual([
      "DOCTOR_ENGAGED_MINUTES_DAILY",
      "DOCTOR_SESSION_COUNT_DAILY",
      "DOCTOR_ACTIVE_DAY",
    ]);
    expect(persisted.every((row) => row.value === 0 && row.sourceVersion === 0)).toBe(true);
    expect(deps.readMinutes).not.toHaveBeenCalled();
    expect(deps.acknowledgeDoctor).toHaveBeenCalledWith({
      doctorId: DOCTOR_ID,
      periodDay: DAY,
      generation: 0,
    });
  });

  it("fails before projection acknowledgement when a Doctor generation moved", async () => {
    const { deps } = makeDeps({
      getContext: vi.fn(async () => ({
        evidenceGeneration: 3,
        reconciledGeneration: 0,
        clinicTimeZone: "Asia/Dhaka",
        retainedMinuteCount: 3,
      })),
    });

    await expect(runActivityReconciliationDay(DAY, deps)).rejects.toThrow(
      "O1F_ACTIVITY_RECONCILIATION_GENERATION_MOVED",
    );
    expect(deps.acknowledgeDoctor).not.toHaveBeenCalled();
    expect(deps.acknowledgeDay).not.toHaveBeenCalled();
    expect(deps.finalizeDay).not.toHaveBeenCalled();
  });

  it("does not close the day when the eligible Doctor set moved", async () => {
    const { deps } = makeDeps({
      getDayWatermark: vi.fn(async () => ({ evidenceGeneration: 0, eligibleDoctorCount: 1 })),
      listDoctors: vi.fn(async () => []),
    });

    await expect(runActivityReconciliationDay(DAY, deps)).rejects.toThrow(
      "O1F_ACTIVITY_DOCTOR_SET_MOVED",
    );
    expect(deps.acknowledgeDay).not.toHaveBeenCalled();
    expect(deps.finalizeDay).not.toHaveBeenCalled();
  });

  it("rejects malformed evidence surfaces before any acknowledgement", async () => {
    const { deps } = makeDeps({
      getDayWatermark: vi.fn(async () => ({ evidenceGeneration: 1, eligibleDoctorCount: 1 })),
      listDoctors: vi.fn(async ({ afterDoctorId }) =>
        afterDoctorId
          ? []
          : [
              {
                doctorId: DOCTOR_ID,
                evidenceGeneration: 1,
                reconciledGeneration: 0,
                clinicTimeZone: "Asia/Dhaka",
                hasEvidence: true,
              },
            ],
      ),
      getContext: vi.fn(async () => ({
        evidenceGeneration: 1,
        reconciledGeneration: 0,
        clinicTimeZone: "Asia/Dhaka",
        retainedMinuteCount: 1,
      })),
      readMinutes: vi.fn(async () => [
        { minuteBucket: "2026-09-13T04:00:00.000Z", surface: "PATIENT_UUID" },
      ]),
    });

    await expect(runActivityReconciliationDay(DAY, deps)).rejects.toThrow(
      "O1F_ACTIVITY_SURFACE_INVALID",
    );
    expect(deps.acknowledgeDoctor).not.toHaveBeenCalled();
  });
});
