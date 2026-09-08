import type {
  AiProposalPayload,
  MedicineProposal,
  PrescriptionMedicineProposal,
} from "./contracts";
import type { SyntheticEvalCase } from "./synthetic-eval-corpus";

export interface SyntheticEvalPrediction {
  caseId: string;
  proposal: AiProposalPayload | null;
  errorCode?: string;
}

export interface RatioMetric {
  correct: number;
  total: number;
  rate: number | null;
}

export interface SyntheticEvalMetrics {
  cases: number;
  providerErrors: number;
  medicineName: RatioMetric;
  strength: RatioMetric;
  dose: RatioMetric;
  schedule: RatioMetric;
  duration: RatioMetric;
  explicitInvestigationRecall: RatioMetric;
  extraInvestigations: { extra: number; predicted: number; rate: number | null };
  ambiguityDisclosure: RatioMetric;
  mixedInput: RatioMetric;
  casePasses: Array<{ id: string; passed: boolean; errors: string[] }>;
}

function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return text(a) === text(b);
}

function ratio(correct: number, total: number): RatioMetric {
  return { correct, total, rate: total === 0 ? null : correct / total };
}

function rx(value: AiProposalPayload | null): PrescriptionMedicineProposal | null {
  return value?.kind === "PRESCRIPTION_MEDICINE" ? value : null;
}

function expectedStringField(
  expected: MedicineProposal,
  actual: MedicineProposal | undefined,
  field: keyof MedicineProposal,
): { score: boolean | null; error?: string } {
  const target = expected[field];
  if (typeof target !== "string") return { score: null };
  const got = actual?.[field];
  return {
    score: typeof got === "string" && sameText(target, got),
    error: typeof got === "string" && sameText(target, got) ? undefined : `${String(field)} mismatch`,
  };
}

function investigationNames(value: AiProposalPayload | null): string[] {
  if (value?.kind !== "INVESTIGATION_LIST") return [];
  return value.investigations.map((item) => text(item.name)!).filter(Boolean);
}

function pushScore(
  accumulator: { correct: number; total: number },
  result: { score: boolean | null },
): void {
  if (result.score === null) return;
  accumulator.total += 1;
  if (result.score) accumulator.correct += 1;
}

/**
 * Semantic scoring deliberately runs after DD structural validation. Rates use
 * normalized exact text (Unicode NFKC + whitespace collapse + case-fold only);
 * values, units, abbreviations and language are otherwise not translated or
 * clinically normalized.
 */
export function scoreSyntheticEvaluation(
  corpus: readonly SyntheticEvalCase[],
  predictions: readonly SyntheticEvalPrediction[],
): SyntheticEvalMetrics {
  const byId = new Map(predictions.map((prediction) => [prediction.caseId, prediction]));
  const medicineName = { correct: 0, total: 0 };
  const strength = { correct: 0, total: 0 };
  const dose = { correct: 0, total: 0 };
  const schedule = { correct: 0, total: 0 };
  const duration = { correct: 0, total: 0 };
  const investigation = { correct: 0, total: 0 };
  const ambiguity = { correct: 0, total: 0 };
  const mixed = { correct: 0, total: 0 };
  let extraInvestigations = 0;
  let predictedInvestigations = 0;
  let providerErrors = 0;
  const casePasses: SyntheticEvalMetrics["casePasses"] = [];

  for (const item of corpus) {
    const prediction = byId.get(item.id);
    const actual = prediction?.proposal ?? null;
    const errors: string[] = [];
    if (!prediction || prediction.errorCode || actual === null) {
      providerErrors += 1;
      errors.push(prediction?.errorCode ?? "NO_VALID_PROPOSAL");
    }

    if (item.expected.kind === "PRESCRIPTION_MEDICINE") {
      const got = rx(actual);
      if (!got) errors.push("proposal kind mismatch");
      const fields = [
        ["display_name", medicineName],
        ["strength_text", strength],
        ["dose_text", dose],
        ["schedule_text", schedule],
        ["duration_text", duration],
      ] as const;
      for (const [field, accumulator] of fields) {
        const result = expectedStringField(item.expected.medicine, got?.medicine, field);
        pushScore(accumulator, result);
        if (result.score === false && result.error) errors.push(result.error);
        if (item.language === "MIXED" && result.score !== null) {
          mixed.total += 1;
          if (result.score) mixed.correct += 1;
        }
      }

      for (const expectedUncertainty of item.expected.uncertainties) {
        ambiguity.total += 1;
        const disclosed =
          got?.uncertainties.some(
            (candidate) =>
              candidate.code === expectedUncertainty.code &&
              candidate.field === expectedUncertainty.field,
          ) ?? false;
        if (disclosed) ambiguity.correct += 1;
        else errors.push(`missing ambiguity ${expectedUncertainty.code}:${expectedUncertainty.field}`);
        if (item.language === "MIXED") {
          mixed.total += 1;
          if (disclosed) mixed.correct += 1;
        }
      }

      // A hand-authored expected null means the model must not manufacture a value.
      for (const [field, target] of Object.entries(item.expected.medicine)) {
        if (target !== null) continue;
        const gotValue = got?.medicine[field as keyof MedicineProposal];
        const safelyMissing = gotValue === null || gotValue === undefined;
        if (!safelyMissing) errors.push(`${field} should remain null/omitted`);
        if (item.language === "MIXED") {
          mixed.total += 1;
          if (safelyMissing) mixed.correct += 1;
        }
      }
    } else if (item.expected.kind === "INVESTIGATION_LIST") {
      const expected = item.expected.investigations.map((entry) => text(entry.name)!);
      const got = investigationNames(actual);
      predictedInvestigations += got.length;
      for (const expectedName of expected) {
        investigation.total += 1;
        const found = got.includes(expectedName);
        if (found) investigation.correct += 1;
        else errors.push(`missing investigation ${expectedName}`);
        if (item.language === "MIXED") {
          mixed.total += 1;
          if (found) mixed.correct += 1;
        }
      }
      for (const name of got) {
        if (!expected.includes(name)) {
          extraInvestigations += 1;
          errors.push(`extra investigation ${name}`);
          if (item.language === "MIXED") mixed.total += 1;
        }
      }
    }

    casePasses.push({ id: item.id, passed: errors.length === 0, errors });
  }

  return {
    cases: corpus.length,
    providerErrors,
    medicineName: ratio(medicineName.correct, medicineName.total),
    strength: ratio(strength.correct, strength.total),
    dose: ratio(dose.correct, dose.total),
    schedule: ratio(schedule.correct, schedule.total),
    duration: ratio(duration.correct, duration.total),
    explicitInvestigationRecall: ratio(investigation.correct, investigation.total),
    extraInvestigations: {
      extra: extraInvestigations,
      predicted: predictedInvestigations,
      rate: predictedInvestigations === 0 ? null : extraInvestigations / predictedInvestigations,
    },
    ambiguityDisclosure: ratio(ambiguity.correct, ambiguity.total),
    mixedInput: ratio(mixed.correct, mixed.total),
    casePasses,
  };
}
