import { z } from "zod";

const nullableText = z.string().trim().min(1).max(2000).nullable();
const sourceRefSchema = z.object({
  kind: z.enum(["consultation", "investigation", "draft", "medicine_reference"]),
  ref: z.string().min(1).max(200),
}).strict();

export const autopilotMedicineSchema = z.object({
  medicineReferenceId: z.uuid().nullable(),
  displayName: nullableText,
  brandName: nullableText,
  genericName: nullableText,
  strengthText: nullableText,
  doseText: nullableText,
  dosageForm: nullableText,
  route: nullableText,
  scheduleText: nullableText,
  durationText: nullableText,
  quantityText: nullableText,
  foodRelation: nullableText,
  instructions: nullableText,
  isPrn: z.boolean().nullable(),
  substitutionAllowed: z.boolean().nullable(),
  needsReview: z.array(z.string().min(1).max(300)).max(20),
  sourceRefs: z.array(sourceRefSchema).max(20),
}).strict();

export const autopilotInvestigationSchema = z.object({
  name: nullableText,
  note: nullableText,
  needsReview: z.array(z.string().min(1).max(300)).max(20),
  sourceRefs: z.array(sourceRefSchema).max(20),
}).strict();

export const autopilotPrescriptionSchema = z.object({
  type: z.literal("AUTOPILOT_PRESCRIPTION"),
  schemaVersion: z.literal(1),
  status: z.enum(["PROPOSAL", "NEEDS_REVIEW"]),
  medicines: z.array(autopilotMedicineSchema).max(100),
  investigations: z.array(autopilotInvestigationSchema).max(100),
  advice: z.array(z.object({ text: nullableText, sourceRefs: z.array(sourceRefSchema).max(20) }).strict()).max(100),
  followUp: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    intervalText: nullableText,
    note: nullableText,
    needsReview: z.array(z.string().min(1).max(300)).max(20),
    sourceRefs: z.array(sourceRefSchema).max(20),
  }).strict(),
  warnings: z.array(z.string().min(1).max(500)).max(100),
  uncertainties: z.array(z.string().min(1).max(500)).max(100),
  context: z.object({
    doctorId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    practiceLocationId: z.uuid(),
    prescriptionId: z.uuid().nullable(),
    encounterVersion: z.number().int().positive(),
    prescriptionVersion: z.number().int().positive().nullable(),
  }).strict(),
}).strict();

export type AutopilotPrescription = z.infer<typeof autopilotPrescriptionSchema>;

const draftMedicineItemSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1).max(2000),
  brandName: z.string().max(2000).nullable(),
  genericName: z.string().max(2000).nullable(),
  strengthText: z.string().max(2000).nullable(),
  doseText: z.string().max(2000).nullable(),
  dosageForm: z.string().max(2000).nullable(),
  route: z.string().max(2000).nullable(),
  scheduleText: z.string().max(2000).nullable(),
  durationText: z.string().max(2000).nullable(),
  quantityText: z.string().max(2000).nullable(),
  foodRelation: z.string().max(2000).nullable(),
  instructions: z.string().max(2000).nullable(),
  isPrn: z.boolean(),
  substitutionAllowed: z.boolean(),
}).strict();

export const boundAutopilotContextSchema = z.object({
  actor: z.object({ userId: z.uuid() }).strict(),
  doctor: z.object({ doctorId: z.uuid(), userId: z.uuid() }).strict(),
  practice: z.object({ locationId: z.uuid(), locationName: z.string().min(1).max(300) }).strict(),
  patient: z.object({ patientId: z.uuid() }).strict(),
  encounter: z.object({
    encounterId: z.uuid(),
    patientId: z.uuid(),
    practiceLocationId: z.uuid(),
    status: z.literal("DRAFT"),
    version: z.number().int().positive(),
    consultationText: z.record(z.string(), z.string().max(20000)),
    investigations: z.array(z.object({ id: z.uuid(), name: z.string().max(1000), note: z.string().max(4000).nullable() }).strict()).max(200),
  }).strict(),
  draft: z.object({
    prescriptionId: z.uuid(),
    encounterId: z.uuid(),
    patientId: z.uuid(),
    practiceLocationId: z.uuid(),
    status: z.literal("DRAFT"),
    version: z.number().int().positive(),
    items: z.array(draftMedicineItemSchema).max(100),
  }).strict().nullable(),
  medicineReferences: z.array(z.object({
    id: z.uuid(),
    displayName: z.string().min(1).max(1000),
    genericName: z.string().max(1000).nullable(),
    brandName: z.string().max(1000).nullable(),
    strengthText: z.string().max(500).nullable(),
    dosageForm: z.string().max(500).nullable(),
  }).strict()).max(500),
}).strict();

export type BoundAutopilotContext = z.infer<typeof boundAutopilotContextSchema>;

export interface AutopilotProvider {
  readonly id: string;
  generate(context: BoundAutopilotContext): Promise<unknown>;
}

export type AutopilotGenerationResult =
  | { ok: true; proposal: AutopilotPrescription }
  | { ok: false; reason: "invalid-context" | "binding-rejected" | "malformed-provider-output"; message: string };
