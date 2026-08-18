import { computeAge } from "@/features/patients/identity";
import { formatAgeSex } from "@/lib/format";
import type { BundleItem, ReviewBundle } from "./review-bundle";

/**
 * The bundle, arranged for rendering.
 *
 * ONE view model, deliberately. Stage 7C-3 adds print and "Save as PDF", and
 * both must read from this — two renderers interpreting the same clinical data
 * will eventually disagree, and the disagreement gets discovered on paper in a
 * patient's hand. Pure and free of JSX so the screen and the print stylesheet
 * cannot drift apart.
 *
 * Every value here comes from the BUNDLE. Nothing reaches for today's doctor
 * profile, patient row, location or template — the doctor must review exactly
 * the content whose digest they will approve.
 */

export interface ReviewLine {
  position: number;
  /** What prints as the medicine. Never merged with anything else. */
  name: string;
  /** Brand / generic, when they add something the name does not already say. */
  subtitle: string | null;
  /**
   * Strength and dose stay APART. "500 mg" is what the tablet contains, "1
   * tablet" is what the patient takes; a renderer that joins them invents a
   * dose (ADR 0011 §5).
   */
  strength: string | null;
  dose: string | null;
  /** Form + route, when given. */
  administration: string | null;
  schedule: string | null;
  duration: string | null;
  quantity: string | null;
  foodRelation: string | null;
  isPrn: boolean;
  substitutionAllowed: boolean;
  instructions: string | null;
}

export interface ReviewHeader {
  clinicName: string | null;
  addressLine: string | null;
  phone: string | null;
  headerNote: string | null;
  doctorName: string | null;
  /** Qualification / specialization / designation, in the template's order. */
  credentials: string[];
  bmdc: string | null;
}

export interface ReviewPatient {
  fullName: string | null;
  patientNumber: string | null;
  ageSex: string;
}

export type SignatureState =
  /** The layout hides it. Nothing is missing. */
  | { kind: "hidden" }
  /** Shown, and a frozen object exists. */
  | { kind: "frozen"; path: string }
  /** Shown, and nothing has been frozen yet — expected during 7C-1. */
  | { kind: "not-frozen" };

export interface ReviewView {
  paperSize: "A4" | "A5";
  marginMm: number;
  baseFontPt: number;
  header: ReviewHeader | null;
  patient: ReviewPatient;
  lines: ReviewLine[];
  footerText: string | null;
  showFooter: boolean;
  signature: SignatureState;
  templateName: string | null;
  templateSource: "location" | "global" | "system";
}

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function join(parts: (string | null)[], separator: string): string | null {
  const kept = parts.map(clean).filter((p): p is string => p !== null);
  return kept.length === 0 ? null : kept.join(separator);
}

/**
 * One medicine, as it will print.
 *
 * The brand/generic subtitle is dropped when it would only repeat the display
 * name — a prescription that says "Napa" three times reads as three facts.
 */
export function toLine(item: BundleItem): ReviewLine {
  const name = item.display_name.trim();
  const lower = name.toLowerCase();

  const brand = clean(item.brand_name);
  const generic = clean(item.generic_name);
  const extra = [brand, generic].filter(
    (v): v is string => v !== null && !lower.includes(v.toLowerCase()),
  );

  return {
    position: item.position,
    name,
    subtitle: extra.length === 0 ? null : extra.join(" · "),
    strength: clean(item.strength_text),
    dose: clean(item.dose_text),
    administration: join([item.dosage_form, item.route], " · "),
    schedule: clean(item.schedule_text),
    duration: clean(item.duration_text),
    quantity: clean(item.quantity_text),
    foodRelation: clean(item.food_relation),
    isPrn: item.is_prn,
    substitutionAllowed: item.substitution_allowed,
    instructions: clean(item.instructions),
  };
}

/**
 * Build the printable view from the canonical bundle.
 *
 * `todayISO` is passed in rather than read from the clock so the same bundle
 * renders identically in a test, on the server and in the browser — an age
 * computed from `new Date()` during render is a hydration mismatch waiting to
 * happen, and on this screen it would be a hydration mismatch about a patient's
 * age.
 */
export function toReviewView(bundle: ReviewBundle, todayISO: string): ReviewView {
  const t = bundle.template;

  const age = computeAge(
    {
      dob: bundle.patient.dob,
      dobPrecision: bundle.patient.dobPrecision as never,
      approxAgeYears: bundle.patient.approxAgeYears,
      ageRecordedOn: bundle.patient.ageRecordedOn,
    },
    todayISO,
  );

  const credentials = [
    t.showQualification ? clean(bundle.doctor.qualification) : null,
    t.showSpecialization ? clean(bundle.doctor.specialization) : null,
    t.showDesignation ? clean(bundle.doctor.designation) : null,
  ].filter((c): c is string => c !== null);

  const header: ReviewHeader | null = t.showHeader
    ? {
        clinicName: clean(t.clinicNameOverride) ?? clean(bundle.location.name),
        addressLine: t.showChamberAddress
          ? join([bundle.location.address, bundle.location.district], ", ")
          : null,
        phone: t.showChamberPhone ? clean(bundle.location.phone) : null,
        headerNote: clean(t.headerNote),
        doctorName: clean(bundle.doctor.fullName),
        credentials,
        bmdc: t.showBmdc ? clean(bundle.doctor.bmdcRegistrationNo) : null,
      }
    : null;

  /**
   * Ordered by `position`, not by the order the array happened to arrive in.
   * The database already sorts, and sorting again costs nothing — but a
   * prescription whose medicines print in a different order than the doctor
   * arranged is a different prescription.
   */
  const lines = [...bundle.items].sort((a, b) => a.position - b.position).map(toLine);

  const signature: SignatureState = !t.showSignature
    ? { kind: "hidden" }
    : bundle.signature
      ? { kind: "frozen", path: bundle.signature.path }
      : { kind: "not-frozen" };

  return {
    // The template's paper, never a hardcoded A4 — A5 is a supported layout and
    // silently printing it on A4 would change what the doctor approved.
    paperSize: t.paperSize,
    marginMm: t.marginMm,
    baseFontPt: t.baseFontPt,
    header,
    patient: {
      fullName: clean(bundle.patient.fullName),
      patientNumber: clean(bundle.patient.patientNumber),
      ageSex: formatAgeSex(age.years, bundle.patient.sex ?? "", bundle.patient.dobPrecision ?? "DAY"),
    },
    lines,
    footerText: clean(t.footerText),
    showFooter: t.showFooter,
    signature,
    templateName: clean(t.name),
    templateSource: t.source,
  };
}
