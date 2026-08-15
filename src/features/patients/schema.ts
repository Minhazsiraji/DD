import { z } from "zod";

/**
 * Patient form validation. Kept out of actions.ts — that file is "use server"
 * and may export only async functions (see use-server-exports.test.ts).
 */

export const SEXES = ["MALE", "FEMALE", "OTHER", "UNKNOWN"] as const;
export const DOB_PRECISIONS = ["DAY", "MONTH", "YEAR", "AGE_ONLY"] as const;
export const BLOOD_GROUPS = [
  "A_POS", "A_NEG", "B_POS", "B_NEG",
  "AB_POS", "AB_NEG", "O_POS", "O_NEG", "UNKNOWN",
] as const;

export const BLOOD_GROUP_LABEL: Record<(typeof BLOOD_GROUPS)[number], string> = {
  A_POS: "A+", A_NEG: "A−", B_POS: "B+", B_NEG: "B−",
  AB_POS: "AB+", AB_NEG: "AB−", O_POS: "O+", O_NEG: "O−",
  UNKNOWN: "Unknown",
};

export const SEX_LABEL: Record<(typeof SEXES)[number], string> = {
  MALE: "Male",
  FEMALE: "Female",
  OTHER: "Other",
  UNKNOWN: "Not recorded",
};

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

export const patientFormSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the patient's name").max(160),

    /**
     * Age is captured one of two ways. Most patients in a Bangladeshi chamber
     * do not know an exact birth date, and a fabricated one silently corrupts
     * every age-based dose decision downstream.
     */
    ageMode: z.enum(["DOB", "AGE"]).default("AGE"),
    dob: z.string().trim().optional().or(z.literal("")),
    approxAgeYears: z.coerce
      .number()
      .int()
      .min(0, "Age cannot be negative")
      .max(130, "Check that age")
      .optional(),

    sex: z.enum(SEXES).default("UNKNOWN"),
    phone: optionalText(40),
    email: z.union([z.email("Enter a valid email"), z.literal("")]).optional(),
    address: optionalText(300),
    district: optionalText(120),
    bloodGroup: z.enum(BLOOD_GROUPS).default("UNKNOWN"),
    weightKg: z.coerce.number().min(0).max(500).optional(),
    heightCm: z.coerce.number().min(0).max(280).optional(),

    emergencyContactName: optionalText(160),
    emergencyContactPhone: optionalText(40),
    emergencyContactRelationship: optionalText(80),

    /** Comma or newline separated; split server-side. */
    allergies: optionalText(1000),
    conditions: optionalText(1000),
    medications: optionalText(1000),
    alerts: optionalText(1000),

    notes: optionalText(2000),

    /** Set once the doctor has seen and dismissed a duplicate warning. */
    confirmedNotDuplicate: z.coerce.boolean().optional(),
  })
  .refine(
    (v) => v.ageMode !== "DOB" || (v.dob && /^\d{4}-\d{2}-\d{2}$/.test(v.dob)),
    { message: "Enter a valid date of birth", path: ["dob"] },
  )
  .refine((v) => v.ageMode !== "AGE" || v.approxAgeYears != null, {
    message: "Enter an approximate age",
    path: ["approxAgeYears"],
  });

export type PatientFormInput = z.infer<typeof patientFormSchema>;

/** Splits a free-text list into clean items. Empty input yields an empty list. */
export function splitList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 50);
}
