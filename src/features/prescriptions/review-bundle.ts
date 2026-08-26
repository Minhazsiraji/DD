import { z } from "zod";
import { RENDERABLE_SCHEMA_VERSIONS } from "./renderer-version";

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
/**
 * DERIVED FROM THE RENDERER MAP, never listed twice.
 *
 * "We accept this bundle" and "we can print this bundle" have to be the same
 * statement. As two hand-maintained lists they would drift, and the drift has
 * exactly one shape: a version that parses cleanly and then reaches a renderer
 * switch that has no case for it — a prescription that renders as nothing.
 */
export const SUPPORTED_BUNDLE_SCHEMA_VERSIONS: readonly number[] = RENDERABLE_SCHEMA_VERSIONS;
export const CURRENT_BUNDLE_SCHEMA_VERSION = 4;

/**
 * From this version on, a bundle carries the investigations ordered in the
 * consultation and the advice given — so the paper the patient carries holds
 * all three things the doctor wrote.
 *
 * BOTH VERSIONS RENDER, AND NEITHER IS REWRITTEN. A prescription finalised
 * before this stays at 2 and prints exactly as it always did; re-taking that
 * snapshot to add sections would alter a document a doctor signed.
 */
export const BUNDLE_SCHEMA_WITH_ORDERS_AND_ADVICE = 3;

/**
 * From this version on, the printable body is the doctor's own MODULES —
 * resolved, ordered, labelled and frozen — instead of two fixed sections.
 *
 * A v4 bundle therefore has no top-level `investigations` or `advice`: those
 * are modules inside `sections` like everything else. The refinement below
 * REFUSES a v4 bundle that carries them, because a v4 renderer reads `sections`
 * and would print neither — content that was approved and then silently
 * vanished is the exact failure this whole file exists to prevent.
 */
export const BUNDLE_SCHEMA_WITH_MODULES = 4;

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

/**
 * One investigation the doctor ORDERED in this consultation.
 *
 * A request, never a result. There is no status, no value and no
 * interpretation, because there is no results module — and a printed line that
 * implied a test had come back would be the most dangerous kind of wrong.
 */
export const bundleInvestigationSchema = z.object({
  position: z.number().int(),
  name: z.string(),
  /** Why it was asked for. Clinical reasoning, never a finding. */
  note: nullableText,
});

/**
 * A NAMED, FROZEN ARRANGEMENT — not a hint.
 *
 * `two-column` does not mean "lay this out in two columns somehow". It names
 * one specific arrangement, and that arrangement never changes: which side each
 * module lands on is part of what the doctor approved, so a build that shuffled
 * it would reprint a signed document differently. A future arrangement gets a
 * NEW token and old snapshots keep rendering under the old one — the same
 * discipline as `schemaVersion`, one level down.
 *
 * An unrecognised token is refused rather than guessed at, because placement is
 * exactly the thing we would be guessing.
 */
export const bundleLayoutSchema = z.enum(["two-column"]);
export type BundleLayout = z.infer<typeof bundleLayoutSchema>;

/** One line of a list section. `note` is reasoning or detail — never a result. */
const sectionListItemSchema = z.object({
  text: z.string(),
  note: nullableText.optional(),
});

/** One measurement, already carrying its unit, exactly as it was recorded. */
const sectionPairSchema = z.object({ label: z.string(), value: z.string() });

/**
 * One printable module, resolved and frozen.
 *
 * `module` is a plain string, deliberately NOT an enum of the modules this
 * build knows. A section carries its own heading and its own shape, so an
 * unfamiliar module is still fully printable — and printing it under its own
 * label is strictly safer than refusing the whole prescription or, worse,
 * dropping it. Placement has a documented fallback for the same reason.
 */
export const bundleSectionSchema = z.discriminatedUnion("kind", [
  z.object({
    module: z.string(),
    label: z.string(),
    kind: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    module: z.string(),
    label: z.string(),
    kind: z.literal("list"),
    items: z.array(sectionListItemSchema),
  }),
  z.object({
    module: z.string(),
    label: z.string(),
    kind: z.literal("pairs"),
    pairs: z.array(sectionPairSchema),
  }),
]);

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
  /**
   * Optional in SHAPE because a v2 snapshot predates them, REQUIRED at v3 by
   * the refinement below — a v3 bundle that silently parsed without them would
   * drop approved, printable content and print a shorter prescription than the
   * one that was signed.
   */
  investigations: z.array(bundleInvestigationSchema).optional(),
  advice: nullableText.optional(),
  /**
   * v4 only. The frozen arrangement, and the doctor's own modules in the order
   * and under the labels they approved.
   */
  layout: bundleLayoutSchema.optional(),
  sections: z.array(bundleSectionSchema).optional(),
}).superRefine((bundle, ctx) => {
  if (bundle.schemaVersion < BUNDLE_SCHEMA_WITH_ORDERS_AND_ADVICE) return;

  /**
   * v4 REPLACED the two fixed sections with modules, so the two shapes are
   * mutually exclusive. Each side of this is a fail-closed rule about content
   * that was approved and must therefore print.
   */
  if (bundle.schemaVersion >= BUNDLE_SCHEMA_WITH_MODULES) {
    if (bundle.layout === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["layout"],
        message: `schema ${bundle.schemaVersion} must name its layout`,
      });
    }
    if (bundle.sections === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: `schema ${bundle.schemaVersion} must carry sections`,
      });
    }
    /**
     * A v4 bundle carrying the v3 keys would be printed by the v4 renderer,
     * which reads `sections` — so those two sections would be approved and
     * then silently absent from the paper. Refuse it.
     */
    if (bundle.investigations !== undefined || bundle.advice !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: `schema ${bundle.schemaVersion} carries investigations/advice as modules, not top-level keys`,
      });
    }
    return;
  }

  /**
   * FAIL CLOSED, the same rule the schema version itself exists for: a bundle
   * we cannot render faithfully is one we refuse, never one we render partly.
   * `advice` may be null — that means "none given" — but the KEY must be
   * present, because absent and null are different claims.
   */
  if (bundle.investigations === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["investigations"],
      message: `schema ${bundle.schemaVersion} must carry investigations`,
    });
  }
  if (bundle.advice === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["advice"],
      message: `schema ${bundle.schemaVersion} must carry advice`,
    });
  }
  /**
   * And the mirror of the v4 rule: a v3 bundle that carried `sections` would
   * be handed to the v3 renderer, which cannot read them.
   */
  if (bundle.sections !== undefined || bundle.layout !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["sections"],
      message: `schema ${bundle.schemaVersion} has no modular sections`,
    });
  }
});

export type ReviewBundle = z.infer<typeof reviewBundleSchema>;
export type BundleItem = z.infer<typeof bundleItemSchema>;
export type BundleInvestigation = z.infer<typeof bundleInvestigationSchema>;
export type BundleTemplate = z.infer<typeof bundleTemplateSchema>;
export type BundleSection = z.infer<typeof bundleSectionSchema>;

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
