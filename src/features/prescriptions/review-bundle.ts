import { z } from "zod";
import { RENDERABLE_SCHEMA_VERSIONS } from "./renderer-version";

export const SUPPORTED_BUNDLE_SCHEMA_VERSIONS: readonly number[] = RENDERABLE_SCHEMA_VERSIONS;
export const CURRENT_BUNDLE_SCHEMA_VERSION = 5;
export const BUNDLE_SCHEMA_WITH_ORDERS_AND_ADVICE = 3;
export const BUNDLE_SCHEMA_WITH_MODULES = 4;
export const BUNDLE_SCHEMA_WITH_CLINIC_LOGO = 5;

const nullableText = z.string().nullable();

export const bundleDoctorSchema = z.object({
  fullName: nullableText,
  qualification: nullableText,
  specialization: nullableText,
  designation: nullableText,
  bmdcRegistrationNo: nullableText,
});

export const bundleLocationSchema = z.object({
  name: nullableText,
  address: nullableText,
  district: nullableText,
  phone: nullableText,
});

export const bundlePatientSchema = z.object({
  fullName: nullableText,
  patientNumber: nullableText,
  sex: nullableText,
  dob: nullableText,
  dobPrecision: nullableText,
  approxAgeYears: z.number().nullable(),
  ageRecordedOn: nullableText,
});

export const bundleTemplateSchema = z.object({
  source: z.enum(["location", "global", "system"]),
  templateId: z.uuid().nullable(),
  name: nullableText,
  paperSize: z.enum(["A4", "A5"]),
  marginMm: z.number(),
  baseFontPt: z.number(),
  showHeader: z.boolean(),
  showClinicLogo: z.boolean(),
  clinicNameOverride: nullableText,
  headerNote: nullableText,
  showQualification: z.boolean(),
  showSpecialization: z.boolean(),
  showDesignation: z.boolean(),
  showBmdc: z.boolean(),
  showChamberAddress: z.boolean(),
  showChamberPhone: z.boolean(),
  showFooter: z.boolean(),
  footerText: nullableText,
  showSignature: z.boolean(),
});

const bundleAssetSchema = z
  .object({
    objectId: z.string(),
    path: z.string(),
    size: z.union([z.string(), z.number()]).nullable(),
    mimetype: nullableText,
  })
  .nullable();

export const bundleSignatureSchema = bundleAssetSchema;
export const bundleClinicLogoSchema = bundleAssetSchema;

export const bundleItemSchema = z.object({
  position: z.number().int(),
  display_name: z.string(),
  brand_name: nullableText,
  generic_name: nullableText,
  strength_text: nullableText,
  dose_text: nullableText,
  dosage_form: nullableText,
  route: nullableText,
  schedule_text: nullableText,
  duration_text: nullableText,
  quantity_text: nullableText,
  food_relation: nullableText,
  is_prn: z.boolean(),
  instructions: nullableText,
  substitution_allowed: z.boolean(),
});

export const bundleInvestigationSchema = z.object({
  position: z.number().int(),
  name: z.string(),
  note: nullableText,
});

export const bundleLayoutSchema = z.enum(["two-column"]);
export type BundleLayout = z.infer<typeof bundleLayoutSchema>;

const sectionListItemSchema = z.object({
  text: z.string(),
  note: nullableText.optional(),
});
const sectionPairSchema = z.object({ label: z.string(), value: z.string() });

export const bundleSectionSchema = z.discriminatedUnion("kind", [
  z.object({ module: z.string(), label: z.string(), kind: z.literal("text"), text: z.string() }),
  z.object({ module: z.string(), label: z.string(), kind: z.literal("list"), items: z.array(sectionListItemSchema) }),
  z.object({ module: z.string(), label: z.string(), kind: z.literal("pairs"), pairs: z.array(sectionPairSchema) }),
]);

export const reviewBundleSchema = z
  .object({
    schemaVersion: z.number().int(),
    prescriptionId: z.uuid(),
    encounterId: z.uuid(),
    clinicalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "not a clinic date"),
    doctor: bundleDoctorSchema,
    location: bundleLocationSchema,
    patient: bundlePatientSchema,
    template: bundleTemplateSchema,
    signature: bundleSignatureSchema,
    clinicLogo: bundleClinicLogoSchema.optional(),
    items: z.array(bundleItemSchema),
    investigations: z.array(bundleInvestigationSchema).optional(),
    advice: nullableText.optional(),
    layout: bundleLayoutSchema.optional(),
    sections: z.array(bundleSectionSchema).optional(),
  })
  .superRefine((bundle, ctx) => {
    if (bundle.schemaVersion >= BUNDLE_SCHEMA_WITH_CLINIC_LOGO) {
      if (bundle.clinicLogo === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["clinicLogo"],
          message: `schema ${bundle.schemaVersion} must attest its clinic logo state`,
        });
      }
    } else if (bundle.clinicLogo !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["clinicLogo"],
        message: `schema ${bundle.schemaVersion} predates clinic logo identity`,
      });
    }

    if (bundle.schemaVersion < BUNDLE_SCHEMA_WITH_ORDERS_AND_ADVICE) return;

    if (bundle.schemaVersion >= BUNDLE_SCHEMA_WITH_MODULES) {
      if (bundle.layout === undefined) {
        ctx.addIssue({ code: "custom", path: ["layout"], message: `schema ${bundle.schemaVersion} must name its layout` });
      }
      if (bundle.sections === undefined) {
        ctx.addIssue({ code: "custom", path: ["sections"], message: `schema ${bundle.schemaVersion} must carry sections` });
      }
      if (bundle.investigations !== undefined || bundle.advice !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["sections"],
          message: `schema ${bundle.schemaVersion} carries investigations/advice as modules, not top-level keys`,
        });
      }
      return;
    }

    if (bundle.investigations === undefined) {
      ctx.addIssue({ code: "custom", path: ["investigations"], message: `schema ${bundle.schemaVersion} must carry investigations` });
    }
    if (bundle.advice === undefined) {
      ctx.addIssue({ code: "custom", path: ["advice"], message: `schema ${bundle.schemaVersion} must carry advice` });
    }
    if (bundle.sections !== undefined || bundle.layout !== undefined) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: `schema ${bundle.schemaVersion} has no modular sections` });
    }
  });

export type ReviewBundle = z.infer<typeof reviewBundleSchema>;
export type BundleItem = z.infer<typeof bundleItemSchema>;
export type BundleInvestigation = z.infer<typeof bundleInvestigationSchema>;
export type BundleTemplate = z.infer<typeof bundleTemplateSchema>;
export type BundleSection = z.infer<typeof bundleSectionSchema>;
export type BundleClinicLogo = z.infer<typeof bundleClinicLogoSchema>;

export const reviewEnvelopeSchema = z.object({
  bundle: reviewBundleSchema,
  digest: z.string().regex(/^[0-9a-f]{64}$/, "not a sha256 digest"),
  expectedSignaturePath: z.string(),
  version: z.number().int().positive(),
});

export type ReviewEnvelope = z.infer<typeof reviewEnvelopeSchema>;

export type ReviewParse =
  | { ok: true; review: ReviewEnvelope }
  | { ok: false; reason: "unsupported-schema"; found: number }
  | { ok: false; reason: "malformed" };

export function parseReview(raw: unknown): ReviewParse {
  const version = (raw as { bundle?: { schemaVersion?: unknown } })?.bundle?.schemaVersion;
  const supported: readonly number[] = SUPPORTED_BUNDLE_SCHEMA_VERSIONS;

  if (typeof version === "number" && !supported.includes(version)) {
    return { ok: false, reason: "unsupported-schema", found: version };
  }

  const parsed = reviewEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  return { ok: true, review: parsed.data };
}
