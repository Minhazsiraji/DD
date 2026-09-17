"use server";

import { z } from "zod";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConsultation, type Consultation } from "@/features/encounters/queries";
import { saveConsultationAction } from "@/features/encounters/actions";
import { confirmInvestigationsAction } from "@/features/encounters/investigation-v1-actions";
import { listDoctorMedicines } from "@/features/medicines/queries";
import { addMedicineAction, openPrescriptionAction } from "@/features/prescriptions/actions";
import { getPrescription, type PrescriptionDetail } from "@/features/prescriptions/queries";
import { autopilotPrescriptionSchema, type AutopilotPrescription } from "./contracts";
import {
  applyableInvestigations,
  duplicateMedicineDecision,
  incompleteMedicineReason,
  investigationKey,
  medicineExactKey,
  storedMedicineExactKey,
} from "./apply";

const applySchema = z.object({
  proposal: autopilotPrescriptionSchema,
  applyKey: z.uuid(),
  replaceFollowUp: z.boolean().default(false),
  acknowledgeUncertainties: z.boolean().default(false),
}).strict();

export type ApplyAutopilotResult =
  | {
      ok: true;
      prescriptionId: string;
      prescriptionVersion: number;
      encounterVersion: number;
      alreadyApplied: boolean;
    }
  | {
      ok: false;
      reason:
        | "invalid-proposal"
        | "binding-rejected"
        | "stale-context"
        | "conflict"
        | "write-unconfirmed";
      message: string;
    };

function patchForMedicine(medicine: AutopilotPrescription["medicines"][number]) {
  return {
    displayName: medicine.displayName,
    brandName: medicine.brandName,
    genericName: medicine.genericName,
    strengthText: medicine.strengthText,
    doseText: medicine.doseText,
    dosageForm: medicine.dosageForm,
    route: medicine.route,
    scheduleText: medicine.scheduleText,
    durationText: medicine.durationText,
    quantityText: medicine.quantityText,
    foodRelation: medicine.foodRelation,
    instructions: medicine.instructions,
    isPrn: medicine.isPrn ?? false,
    substitutionAllowed: medicine.substitutionAllowed ?? true,
  };
}

function text(value: string | null | undefined) {
  return (value ?? "").trim();
}

function includesLine(haystack: string, needle: string) {
  const target = needle.trim();
  if (!target) return true;
  return haystack.split(/\r?\n/).some((line) => line.trim() === target);
}

function advicePatch(existing: string, proposal: AutopilotPrescription) {
  const additions = proposal.advice
    .map((row) => text(row.text))
    .filter(Boolean)
    .filter((line) => !includesLine(existing, line));
  if (additions.length === 0) return null;
  return [existing.trim(), ...additions].filter(Boolean).join("\n");
}

function fullProposalAlreadyApplied(
  proposal: AutopilotPrescription,
  prescriptionItems: PrescriptionDetail["items"],
  consultation: Consultation,
) {
  const medicineKeys = new Set(prescriptionItems.map(storedMedicineExactKey));
  if (!proposal.medicines.every((medicine) => medicineKeys.has(medicineExactKey(medicine)))) {
    return false;
  }

  const investigationKeys = new Set(
    consultation.investigations.map((row) => investigationKey(row.name, row.note)),
  );
  if (
    !applyableInvestigations(proposal).every((row) =>
      investigationKeys.has(investigationKey(row.name, row.note)),
    )
  ) {
    return false;
  }

  const currentAdvice = consultation.values.advice ?? "";
  if (
    !proposal.advice.every(
      (row) => !row.text || includesLine(currentAdvice, row.text),
    )
  ) {
    return false;
  }

  if (
    proposal.followUp.date &&
    consultation.values.nextVisitOn !== proposal.followUp.date
  ) {
    return false;
  }
  if (
    proposal.followUp.note &&
    consultation.values.nextVisitNote !== proposal.followUp.note
  ) {
    return false;
  }
  return true;
}

export async function applyAutopilotProposalToDraftAction(
  input: unknown,
): Promise<ApplyAutopilotResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid-proposal",
      message: "This Autopilot proposal shape is not accepted by this build.",
    };
  }
  const { proposal, applyKey, replaceFollowUp, acknowledgeUncertainties } = parsed.data;

  if (proposal.uncertainties.length > 0 && !acknowledgeUncertainties) {
    return {
      ok: false,
      reason: "invalid-proposal",
      message: "Review and acknowledge proposal uncertainties before applying.",
    };
  }

  for (const medicine of proposal.medicines) {
    const incomplete = incompleteMedicineReason(medicine);
    if (incomplete) {
      return { ok: false, reason: "invalid-proposal", message: incomplete };
    }
  }
  if (proposal.investigations.some((row) => row.needsReview.length > 0 || !row.name)) {
    return {
      ok: false,
      reason: "invalid-proposal",
      message: "Resolve investigation names and uncertainties before applying.",
    };
  }
  if (proposal.investigations.some((row) => !row.sourceRefs.some((ref) => ref.kind === "consultation"))) {
    return {
      ok: false,
      reason: "invalid-proposal",
      message: "Investigation history is context only. Remove or explicitly re-propose the investigation from the current consultation.",
    };
  }
  if (proposal.followUp.needsReview.length > 0) {
    return {
      ok: false,
      reason: "invalid-proposal",
      message: "Resolve follow-up uncertainty before applying.",
    };
  }

  const ctx = await requireLocationContext();
  if (!ctx.roles.includes("DOCTOR")) {
    return {
      ok: false,
      reason: "binding-rejected",
      message: "Only the treating doctor may apply an Autopilot proposal.",
    };
  }
  if (proposal.context.practiceLocationId !== ctx.locationId) {
    return {
      ok: false,
      reason: "binding-rejected",
      message: "The active practice location no longer matches this proposal.",
    };
  }

  const consultationOutcome = await getConsultation(
    proposal.context.encounterId,
    ctx.locationId,
  );
  if (!consultationOutcome.ok) {
    return {
      ok: false,
      reason: "binding-rejected",
      message: "The active consultation could not be verified.",
    };
  }
  let consultation = consultationOutcome.consultation;
  if (
    consultation.patient.id !== proposal.context.patientId ||
    consultation.practiceLocationId !== ctx.locationId
  ) {
    return {
      ok: false,
      reason: "binding-rejected",
      message: "The patient or location no longer matches this proposal.",
    };
  }
  if (consultation.status !== "DRAFT") {
    return {
      ok: false,
      reason: "binding-rejected",
      message: "Autopilot cannot change a completed consultation.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: doctorRow, error: doctorError } = await supabase
    .from("doctor_profiles")
    .select("id, user_id")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (
    doctorError ||
    !doctorRow ||
    String(doctorRow.id) !== proposal.context.doctorId
  ) {
    return {
      ok: false,
      reason: "binding-rejected",
      message: "Doctor authority no longer matches this proposal.",
    };
  }

  let prescriptionId = proposal.context.prescriptionId;
  let prescription: PrescriptionDetail | null = null;
  if (prescriptionId) {
    const rxOutcome = await getPrescription(prescriptionId, ctx.locationId);
    if (!rxOutcome.ok) {
      return {
        ok: false,
        reason: "binding-rejected",
        message: "The prescription draft could not be verified.",
      };
    }
    prescription = rxOutcome.prescription;
    if (prescription.status !== "DRAFT") {
      return {
        ok: false,
        reason: "binding-rejected",
        message: "Finalized or voided prescriptions cannot be changed by Autopilot.",
      };
    }
    if (
      prescription.encounterId !== consultation.id ||
      prescription.patientId !== consultation.patient.id ||
      prescription.practiceLocationId !== ctx.locationId
    ) {
      return {
        ok: false,
        reason: "binding-rejected",
        message: "The prescription draft no longer matches this consultation.",
      };
    }

    const staleEncounter =
      consultation.version !== proposal.context.encounterVersion;
    const stalePrescription =
      prescription.version !== proposal.context.prescriptionVersion;
    if (staleEncounter || stalePrescription) {
      if (
        fullProposalAlreadyApplied(proposal, prescription.items, consultation)
      ) {
        return {
          ok: true,
          prescriptionId,
          prescriptionVersion: prescription.version,
          encounterVersion: consultation.version,
          alreadyApplied: true,
        };
      }
      return {
        ok: false,
        reason: "stale-context",
        message:
          "The consultation or prescription changed after generation. Regenerate and review before applying.",
      };
    }
  } else if (consultation.version !== proposal.context.encounterVersion) {
    return {
      ok: false,
      reason: "stale-context",
      message:
        "The consultation changed after generation. Regenerate and review before applying.",
    };
  }

  const currentDateBeforeWrite = text(consultation.values.nextVisitOn);
  const currentNoteBeforeWrite = text(consultation.values.nextVisitNote);
  const proposedDateBeforeWrite = text(proposal.followUp.date);
  const proposedNoteBeforeWrite = text(proposal.followUp.note);
  const followUpConflictsBeforeWrite =
    (proposedDateBeforeWrite && currentDateBeforeWrite && proposedDateBeforeWrite !== currentDateBeforeWrite) ||
    (proposedNoteBeforeWrite && currentNoteBeforeWrite && proposedNoteBeforeWrite !== currentNoteBeforeWrite);
  if (followUpConflictsBeforeWrite && !replaceFollowUp) {
    return {
      ok: false,
      reason: "conflict",
      message:
        "An existing doctor-authored follow-up differs from the proposal. Choose replacement explicitly or edit/remove the proposed follow-up.",
    };
  }

  const references = await listDoctorMedicines();
  const referenceIds = new Set(
    references.flatMap((row) =>
      row.medicineReferenceId ? [row.medicineReferenceId] : [],
    ),
  );
  for (const medicine of proposal.medicines) {
    if (
      medicine.medicineReferenceId &&
      !referenceIds.has(medicine.medicineReferenceId)
    ) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "A proposed medicine reference is no longer available. Review that medicine again.",
      };
    }
    if (!medicine.medicineReferenceId && medicine.displayName) {
      const normalized = medicine.displayName.trim().toLocaleLowerCase();
      const matches = references.filter(
        (row) =>
          row.displayName.trim().toLocaleLowerCase() === normalized ||
          row.brandName?.trim().toLocaleLowerCase() === normalized ||
          row.genericName?.trim().toLocaleLowerCase() === normalized,
      );
      const ids = new Set(
        matches.flatMap((row) =>
          row.medicineReferenceId ? [row.medicineReferenceId] : [],
        ),
      );
      if (ids.size > 1) {
        return {
          ok: false,
          reason: "conflict",
          message: `Medicine “${medicine.displayName}” matches more than one reference. Choose the intended medicine before applying.`,
        };
      }
    }
  }

  if (!prescriptionId) {
    const opened = await openPrescriptionAction({
      encounterId: consultation.id,
    });
    if (!opened.ok) {
      return {
        ok: false,
        reason: "write-unconfirmed",
        message: opened.message,
      };
    }
    prescriptionId = opened.prescriptionId;
    const rxOutcome = await getPrescription(prescriptionId, ctx.locationId);
    if (!rxOutcome.ok || rxOutcome.prescription.status !== "DRAFT") {
      return {
        ok: false,
        reason: "write-unconfirmed",
        message:
          "The editable prescription draft could not be confirmed after opening.",
      };
    }
    prescription = rxOutcome.prescription;
  }

  if (!prescription) {
    return {
      ok: false,
      reason: "write-unconfirmed",
      message: "The editable prescription draft could not be confirmed.",
    };
  }

  for (const medicine of proposal.medicines) {
    const decision = duplicateMedicineDecision(medicine, prescription.items);
    if (decision === "conflict") {
      return {
        ok: false,
        reason: "conflict",
        message: `Existing medicine “${medicine.displayName ?? "medicine"}” has different draft details. Review the collision instead of overwriting it.`,
      };
    }
  }

  for (const medicine of proposal.medicines) {
    if (
      duplicateMedicineDecision(medicine, prescription.items) === "skip-exact"
    ) {
      continue;
    }
    const result = await addMedicineAction({
      prescriptionId,
      expectedVersion: prescription.version,
      patch: patchForMedicine(medicine),
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.kind === "conflict" ? "stale-context" : "write-unconfirmed",
        message: result.message,
      };
    }
    prescription = {
      ...prescription,
      version: result.version,
      items: result.items,
    };
  }

  const candidates = applyableInvestigations(proposal);
  const existingInvestigationKeys = new Set(
    consultation.investigations.map((row) =>
      investigationKey(row.name, row.note),
    ),
  );
  const newInvestigations = candidates.filter(
    (row) =>
      !existingInvestigationKeys.has(investigationKey(row.name, row.note)),
  );
  if (newInvestigations.length > 0) {
    const result = await confirmInvestigationsAction({
      encounterId: consultation.id,
      expectedVersion: consultation.version,
      operationKey: applyKey,
      investigations: newInvestigations.map((row) => ({
        name: row.name!,
        note: row.note,
      })),
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.kind === "conflict" ? "stale-context" : "write-unconfirmed",
        message: result.message,
      };
    }
    consultation = {
      ...consultation,
      version: result.server.version,
      values: result.server.values,
      investigations: result.server.investigations,
    };
  }

  const patch: Record<string, string | null> = {};
  const nextAdvice = advicePatch(consultation.values.advice ?? "", proposal);
  if (nextAdvice !== null) patch.advice = nextAdvice;

  const currentDate = text(consultation.values.nextVisitOn);
  const currentNote = text(consultation.values.nextVisitNote);
  const proposedDate = text(proposal.followUp.date);
  const proposedNote = text(proposal.followUp.note);
  if (proposedDate && proposedDate !== currentDate) {
    patch.nextVisitOn = proposedDate;
  }
  if (proposedNote && proposedNote !== currentNote) {
    patch.nextVisitNote = proposedNote;
  }

  if (Object.keys(patch).length > 0) {
    const save = await saveConsultationAction({
      encounterId: consultation.id,
      expectedVersion: consultation.version,
      patch,
    });
    if (!save.ok) {
      return {
        ok: false,
        reason: save.kind === "conflict" ? "stale-context" : "write-unconfirmed",
        message: save.message,
      };
    }
    consultation = {
      ...consultation,
      version: save.version,
      values: { ...consultation.values, ...patch },
    };
  }

  return {
    ok: true,
    prescriptionId,
    prescriptionVersion: prescription.version,
    encounterVersion: consultation.version,
    alreadyApplied: false,
  };
}
