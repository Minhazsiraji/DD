"use server";

import { z } from "zod";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConsultation } from "@/features/encounters/queries";
import { listDoctorMedicines } from "@/features/medicines/queries";
import { getPrescription } from "@/features/prescriptions/queries";
import { generateAutopilotPrescription } from "./engine";
import { MockAutopilotProvider } from "./mock-provider";
import type { AutopilotGenerationResult, BoundAutopilotContext } from "./contracts";

const requestSchema = z.object({
  encounterId: z.uuid(),
  expectedEncounterVersion: z.number().int().positive(),
  prescriptionId: z.uuid().nullable().optional(),
  expectedPrescriptionVersion: z.number().int().positive().nullable().optional(),
}).strict().superRefine((value, ctx) => {
  const hasId = Boolean(value.prescriptionId);
  const hasVersion = value.expectedPrescriptionVersion != null;
  if (hasId !== hasVersion) {
    ctx.addIssue({ code: "custom", message: "Draft id and version must be supplied together." });
  }
});

export type GenerateAutopilotProposalResult = AutopilotGenerationResult;

/**
 * M6C1 server boundary. All ownership comes from verified server reads. The
 * client supplies identifiers/version expectations only; it never supplies a
 * doctor, patient, practice or clinical context to trust.
 */
export async function generateAutopilotPrescriptionProposalAction(
  input: unknown,
): Promise<GenerateAutopilotProposalResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-context", message: "Autopilot request could not be verified." };
  }

  const ctx = await requireLocationContext();
  if (!ctx.roles.includes("DOCTOR")) {
    return { ok: false, reason: "binding-rejected", message: "Only the treating doctor may generate this proposal." };
  }

  const consultationOutcome = await getConsultation(parsed.data.encounterId, ctx.locationId);
  if (!consultationOutcome.ok) {
    return { ok: false, reason: "binding-rejected", message: "The active consultation could not be verified." };
  }
  const consultation = consultationOutcome.consultation;
  if (consultation.status !== "DRAFT") {
    return { ok: false, reason: "binding-rejected", message: "Autopilot requires an active editable consultation." };
  }
  if (consultation.version !== parsed.data.expectedEncounterVersion) {
    return { ok: false, reason: "binding-rejected", message: "The consultation changed. Reload before generating a proposal." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: doctorRow, error: doctorError } = await supabase
    .from("doctor_profiles")
    .select("id, user_id")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (doctorError || !doctorRow) {
    return { ok: false, reason: "binding-rejected", message: "Doctor identity could not be verified." };
  }

  let draft: BoundAutopilotContext["draft"] = null;
  if (parsed.data.prescriptionId) {
    const prescriptionOutcome = await getPrescription(parsed.data.prescriptionId, ctx.locationId);
    if (!prescriptionOutcome.ok) {
      return { ok: false, reason: "binding-rejected", message: "Prescription draft could not be verified." };
    }
    const prescription = prescriptionOutcome.prescription;
    if (prescription.status !== "DRAFT") {
      return { ok: false, reason: "binding-rejected", message: "Finalized or voided prescriptions cannot be used as an editable Autopilot draft." };
    }
    if (prescription.version !== parsed.data.expectedPrescriptionVersion) {
      return { ok: false, reason: "binding-rejected", message: "The prescription draft changed. Reload before generating a proposal." };
    }
    if (
      prescription.encounterId !== consultation.id ||
      prescription.patientId !== consultation.patient.id ||
      prescription.practiceLocationId !== ctx.locationId
    ) {
      return { ok: false, reason: "binding-rejected", message: "Prescription draft binding does not match the active consultation." };
    }
    draft = {
      prescriptionId: prescription.id,
      encounterId: prescription.encounterId,
      patientId: prescription.patientId,
      practiceLocationId: prescription.practiceLocationId,
      status: "DRAFT",
      version: prescription.version,
    };
  }

  const doctorMedicines = await listDoctorMedicines();
  const referenceById = new Map<string, BoundAutopilotContext["medicineReferences"][number]>();
  for (const medicine of doctorMedicines) {
    if (!medicine.medicineReferenceId) continue;
    if (referenceById.has(medicine.medicineReferenceId)) continue;
    referenceById.set(medicine.medicineReferenceId, {
      id: medicine.medicineReferenceId,
      displayName: medicine.displayName,
      genericName: medicine.genericName,
      brandName: medicine.brandName,
      strengthText: medicine.strengthText,
      dosageForm: medicine.dosageForm,
    });
  }

  const bound: BoundAutopilotContext = {
    actor: { userId: ctx.user.id },
    doctor: { doctorId: doctorRow.id as string, userId: doctorRow.user_id as string },
    practice: { locationId: ctx.locationId, locationName: ctx.locationName },
    patient: { patientId: consultation.patient.id },
    encounter: {
      encounterId: consultation.id,
      patientId: consultation.patient.id,
      practiceLocationId: consultation.practiceLocationId,
      status: "DRAFT",
      version: consultation.version,
      consultationText: { ...consultation.values },
      investigations: consultation.investigations.map((item) => ({ id: item.id, name: item.name, note: item.note })),
    },
    draft,
    medicineReferences: [...referenceById.values()].slice(0, 500),
  };

  // M6C1 remains mock-only. No provider key or live provider client is reachable here.
  return generateAutopilotPrescription(bound, new MockAutopilotProvider());
}
