import { computeAge } from "@/features/patients/identity";
import { formatAgeSex } from "@/lib/format";
import type { BundleItem, ReviewBundle } from "./review-bundle";

export interface ReviewLine {
  position: number;
  name: string;
  subtitle: string | null;
  strength: string | null;
  dose: string | null;
  administration: string | null;
  schedule: string | null;
  duration: string | null;
  quantity: string | null;
  foodRelation: string | null;
  isPrn: boolean;
  substitutionAllowed: boolean;
  instructions: string | null;
}

export interface ReviewInvestigation {
  position: number;
  name: string;
  note: string | null;
}

export interface ReviewHeader {
  clinicName: string | null;
  addressLine: string | null;
  phone: string | null;
  headerNote: string | null;
  doctorName: string | null;
  credentials: string[];
  bmdc: string | null;
}

export interface ReviewPatient {
  fullName: string | null;
  patientNumber: string | null;
  ageSex: string;
}

export type SignatureState =
  | { kind: "hidden" }
  | { kind: "frozen"; path: string }
  | { kind: "not-frozen" };

export type ClinicLogoState =
  | { kind: "hidden" }
  | { kind: "frozen"; path: string }
  | { kind: "not-frozen" };

export interface DocumentChrome {
  clinicalDate: string;
  paperSize: "A4" | "A5";
  marginMm: number;
  baseFontPt: number;
  header: ReviewHeader | null;
  patient: ReviewPatient;
  lines: ReviewLine[];
  footerText: string | null;
  showFooter: boolean;
  signature: SignatureState;
  clinicLogo: ClinicLogoState;
  templateName: string | null;
  templateSource: "location" | "global" | "system";
}

export interface ReviewView extends DocumentChrome {
  renderer: "v3-linear";
  investigations: ReviewInvestigation[];
  advice: string | null;
}

export function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function join(parts: (string | null)[], separator: string): string | null {
  const kept = parts.map(clean).filter((p): p is string => p !== null);
  return kept.length === 0 ? null : kept.join(separator);
}

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

export function toDocumentChrome(bundle: ReviewBundle): DocumentChrome {
  const t = bundle.template;
  const age = computeAge(
    {
      dob: bundle.patient.dob,
      dobPrecision: bundle.patient.dobPrecision as never,
      approxAgeYears: bundle.patient.approxAgeYears,
      ageRecordedOn: bundle.patient.ageRecordedOn,
    },
    bundle.clinicalDate,
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

  const lines = [...bundle.items].sort((a, b) => a.position - b.position).map(toLine);

  const signature: SignatureState = !t.showSignature
    ? { kind: "hidden" }
    : bundle.signature
      ? { kind: "frozen", path: bundle.signature.path }
      : { kind: "not-frozen" };

  const clinicLogo: ClinicLogoState = !t.showClinicLogo
    ? { kind: "hidden" }
    : bundle.clinicLogo
      ? { kind: "frozen", path: bundle.clinicLogo.path }
      : { kind: "not-frozen" };

  return {
    clinicalDate: bundle.clinicalDate,
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
    clinicLogo,
    templateName: clean(t.name),
    templateSource: t.source,
  };
}

export function toReviewView(bundle: ReviewBundle): ReviewView {
  return {
    ...toDocumentChrome(bundle),
    renderer: "v3-linear",
    investigations: [...(bundle.investigations ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((x) => ({ position: x.position, name: x.name.trim(), note: clean(x.note) })),
    advice: clean(bundle.advice ?? null),
  };
}
