import { z } from "zod";

/**
 * The canonical review bundle, as the SERVER built it.
 *
 * This is the only description of a prescription the review screen may render
 * from. Not today's doctor profile, not today's patient row, not today's
 * template — the bundle. The digest the doctor later approves is computed over
 * exactly this content, so anything rendered from another source is something
 * the doctor approved without seeing, or saw without approving.
 *
 * Parsed rather than trusted, for a reason that is not about malice: an
 * unrecognised bundle is a bundle whose printable meaning we do not know, and a
 * prescription rendered on a guess is worse than one that refuses to render.
 */

/**
 * The bundle shapes this build understands.
 *
 * A newer server writing schema 2 must NOT be rendered by a client that only
 * knows schema 1 — it would silently drop whatever field 2 added, and the
 * doctor would approve a digest covering content their screen never showed.
 * Fail closed, always.
 */
export const SUPPORTED_BUNDLE_SCHEMA_VERSIONS = [2] as const;
export const CURRENT_BUNDLE_SCHEMA_VERSION = 2;

/** Kept lenient about NULLs, strict about presence: the DB emits explicit nulls. */
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

/** Mirrors `resolve_prescription_template()`. Every field prints or hides ink. */
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

/**
 * The frozen signature's identity, read from storage by trusted code.
 *
 * `null` is meaningful and distinct from a missing key: it says the layout
 * hides the signature, or the doctor has none, or nothing has been frozen yet.
 * The digest covers the difference.
 */
export const bundleSignatureSchema = z
  .object({
    objectId: z.string(),
    path: z.string(),
    size: z.union([z.string(), z.number()]).nullable(),
    mimetype: nullableText,
  })
  .nullable();

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

export const reviewBundleSchema = z.object({
  schemaVersion: z.number().int(),
  prescriptionId: z.uuid(),
  encounterId: z.uuid(),
  /**
   * The prescription's own date — the clinic day the patient was seen, in the
   * LOCATION's timezone.
   *
   * Every printable value that depends on time is computed from this and
   * nothing else. Required, not optional: a bundle without it cannot render an
   * age that the digest covers, and a bundle we cannot render is one we refuse.
   */
  clinicalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "not a clinic date"),
  doctor: bundleDoctorSchema,
  location: bundleLocationSchema,
  patient: bundlePatientSchema,
  template: bundleTemplateSchema,
  signature: bundleSignatureSchema,
  items: z.array(bundleItemSchema),
});

export type ReviewBundle = z.infer<typeof reviewBundleSchema>;
export type BundleItem = z.infer<typeof bundleItemSchema>;
export type BundleTemplate = z.infer<typeof bundleTemplateSchema>;

/**
 * What the RPC returns around the bundle.
 *
 * `expectedSignaturePath` is DERIVED, not authoritative — it is where trusted
 * code will put the frozen object, never an instruction the browser may act on.
 * Nothing in the client may write to it.
 */
export const reviewEnvelopeSchema = z.object({
  bundle: reviewBundleSchema,
  digest: z.string().regex(/^[0-9a-f]{64}$/, "not a sha256 digest"),
  expectedSignaturePath: z.string(),
  version: z.number().int().positive(),
});

export type ReviewEnvelope = z.infer<typeof reviewEnvelopeSchema>;

export type ReviewParse =
  | { ok: true; review: ReviewEnvelope }
  /** A shape from a build that is not this one. Never rendered on a guess. */
  | { ok: false; reason: "unsupported-schema"; found: number }
  | { ok: false; reason: "malformed" };

/**
 * Parse what the server sent, refusing anything this build cannot print.
 *
 * The schema-version check runs FIRST and separately from validation, so an
 * unknown future bundle is reported as exactly that rather than as a pile of
 * field errors — the two need different messages and different fixes.
 */
export function parseReview(raw: unknown): ReviewParse {
  const version = (raw as { bundle?: { schemaVersion?: unknown } })?.bundle?.schemaVersion;

  // Widened deliberately: a cast to the current literal version would have to
  // be edited every time a version is added, and forgetting is silent.
  const supported: readonly number[] = SUPPORTED_BUNDLE_SCHEMA_VERSIONS;

  if (typeof version === "number" && !supported.includes(version)) {
    return { ok: false, reason: "unsupported-schema", found: version };
  }

  const parsed = reviewEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  return { ok: true, review: parsed.data };
}
