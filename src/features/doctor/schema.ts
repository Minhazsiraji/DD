import { z } from "zod";
import type { ActionState } from "@/features/auth/schema";

/** Save returns the id so a newly created template can be selected immediately. */
export interface TemplateActionState extends ActionState {
  templateId?: string;
}

/** Kept out of the "use server" files, which may export only async functions. */

export const doctorProfileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(120),
  qualification: z.string().trim().max(200).optional().or(z.literal("")),
  specialization: z.string().trim().max(200).optional().or(z.literal("")),
  designation: z.string().trim().max(120).optional().or(z.literal("")),
  bmdcRegistrationNo: z.string().trim().max(60).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  /**
   * Drives the patient numbering series. Changing it does not renumber existing
   * patients — the UI says so, because a doctor would reasonably assume it did.
   */
  patientNumberPrefix: z
    .string()
    .trim()
    .min(1, "Enter a prefix")
    .max(5, "Keep it to five characters")
    .regex(/^[A-Za-z]+$/, "Letters only")
    .transform((s) => s.toUpperCase()),
});

export const locationDetailsSchema = z.object({
  locationId: z.uuid(),
  name: z.string().trim().min(2, "Enter a name").max(160),
  type: z.enum(["PERSONAL_CHAMBER", "CLINIC", "HOSPITAL", "TELEMEDICINE", "OTHER"]),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  district: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export const PAPER_SIZES = ["A4", "A5"] as const;

export const templateSchema = z.object({
  templateId: z.uuid().optional(),
  name: z.string().trim().min(1, "Name this template").max(80),
  /** Empty string = applies at every location. */
  practiceLocationId: z.union([z.uuid(), z.literal("")]).optional(),

  paperSize: z.enum(PAPER_SIZES).default("A4"),
  marginMm: z.coerce.number().int().min(5).max(40).default(15),
  baseFontPt: z.coerce.number().int().min(8).max(16).default(11),

  showHeader: z.coerce.boolean().default(true),
  showClinicLogo: z.coerce.boolean().default(false),
  clinicNameOverride: z.string().trim().max(160).optional().or(z.literal("")),
  headerNote: z.string().trim().max(200).optional().or(z.literal("")),

  showQualification: z.coerce.boolean().default(true),
  showSpecialization: z.coerce.boolean().default(true),
  showDesignation: z.coerce.boolean().default(true),
  showBmdc: z.coerce.boolean().default(true),
  showChamberAddress: z.coerce.boolean().default(true),
  showChamberPhone: z.coerce.boolean().default(true),

  showFooter: z.coerce.boolean().default(true),
  footerText: z.string().trim().max(300).optional().or(z.literal("")),
  showSignature: z.coerce.boolean().default(true),
});

export type TemplateInput = z.infer<typeof templateSchema>;

/** Shape the A4 preview renders from — deliberately data, not a DB row. */
export interface TemplateSettings {
  id?: string;
  name: string;
  practiceLocationId: string | null;
  isDefault: boolean;
  paperSize: "A4" | "A5";
  marginMm: number;
  baseFontPt: number;
  showHeader: boolean;
  showClinicLogo: boolean;
  clinicNameOverride: string | null;
  headerNote: string | null;
  showQualification: boolean;
  showSpecialization: boolean;
  showDesignation: boolean;
  showBmdc: boolean;
  showChamberAddress: boolean;
  showChamberPhone: boolean;
  showFooter: boolean;
  footerText: string | null;
  showSignature: boolean;
}

export const DEFAULT_TEMPLATE: TemplateSettings = {
  name: "Standard",
  practiceLocationId: null,
  isDefault: true,
  paperSize: "A4",
  marginMm: 15,
  baseFontPt: 11,
  showHeader: true,
  showClinicLogo: false,
  clinicNameOverride: null,
  headerNote: null,
  showQualification: true,
  showSpecialization: true,
  showDesignation: true,
  showBmdc: true,
  showChamberAddress: true,
  showChamberPhone: true,
  showFooter: true,
  footerText: null,
  showSignature: true,
};

/**
 * The template that would be used at a location: the location-specific default
 * if one exists, otherwise the doctor's global default. Pure, so the rule that
 * decides which paper a prescription prints on is testable on its own — the
 * prescription engine will call this same function later.
 */
export function resolveTemplateForLocation(
  templates: TemplateSettings[],
  locationId: string | null,
): TemplateSettings | null {
  const scoped = templates.find(
    (t) => t.isDefault && locationId !== null && t.practiceLocationId === locationId,
  );
  if (scoped) return scoped;
  return templates.find((t) => t.isDefault && t.practiceLocationId === null) ?? null;
}

/** Paper dimensions in millimetres — used to size the preview truthfully. */
export const PAPER_MM: Record<"A4" | "A5", { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
};
