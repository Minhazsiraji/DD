import type { BundleItem, BundleSection, ReviewBundle } from "./review-bundle";

/**
 * FIXTURES FOR THE PRINT HARNESS — synthetic, and permanent.
 *
 * Every scenario here is a case that has to keep printing correctly: the short
 * prescription whose signature must sit at the foot of the page, the long one
 * that has to paginate without losing a line, the historical v3 snapshot that
 * must keep rendering through the v3 document, and the edge content that has
 * broken this renderer before (`500g`, a long Bangla instruction, a name that
 * fills the header).
 *
 * They are hand-written bundles, not database rows. That is deliberate: the
 * harness exists to exercise the RENDERER against known input, so it must not
 * need a doctor, a patient, a login or a Supabase project — and it can never
 * write anything anywhere.
 *
 * No real person appears. Every name, chamber and registration number is
 * obviously invented.
 */

const DOCTOR = {
  fullName: "Dr. Rehana Karim",
  qualification: "MBBS, FCPS (Medicine)",
  specialization: "Internal Medicine",
  designation: "Consultant",
  bmdcRegistrationNo: "A-00000 (sample)",
};

const LOCATION = {
  name: "Sample Chamber",
  address: "House 00, Road 0, Dhanmondi",
  district: "Dhaka",
  phone: "+880 1000-000000",
};

const PATIENT = {
  fullName: "Test Patient",
  patientNumber: "P-000123",
  sex: "FEMALE",
  dob: "1988-04-11",
  dobPrecision: "DAY",
  approxAgeYears: null,
  ageRecordedOn: null,
};

function template(overrides: Partial<ReviewBundle["template"]> = {}): ReviewBundle["template"] {
  return {
    source: "system",
    templateId: null,
    name: "Harness template",
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
    footerText: "Emergency: +880 1000-000000 · Please bring this prescription on every visit.",
    /**
     * ON, but never FROZEN — and the difference is the whole point.
     *
     * The block must render, because it is part of what settles at the foot of
     * the page and part of what a long prescription has to carry to its last
     * sheet. What it must not do is attest a real object: a frozen signature is
     * a real file in Storage, and `prescription-assets` deliberately has no
     * DELETE policy, so a harness that created one would leave a permanent
     * artefact in the project that also holds real clinical work.
     *
     * `showSignature: true` with `signature: null` is exactly the "shown, not
     * frozen yet" state — it draws the empty rule and the doctor's name, writes
     * nothing anywhere, and needs no login, no bucket and no network.
     */
    showSignature: true,
    ...overrides,
  };
}

function medicine(position: number, o: Partial<BundleItem> = {}): BundleItem {
  return {
    position,
    display_name: "Napa",
    brand_name: null,
    generic_name: "Paracetamol",
    strength_text: "500 mg",
    dose_text: "1 tablet",
    dosage_form: "Tablet",
    route: "Oral",
    schedule_text: "1 + 0 + 1",
    duration_text: "5 days",
    quantity_text: null,
    food_relation: "After food",
    is_prn: false,
    instructions: null,
    substitution_allowed: true,
    ...o,
  };
}

function text(module: string, label: string, body: string): BundleSection {
  return { module, label, kind: "text", text: body };
}

function list(
  module: string,
  label: string,
  items: { text: string; note?: string | null }[],
): BundleSection {
  return { module, label, kind: "list", items };
}

const VITALS: BundleSection = {
  module: "VITALS",
  label: "Vitals",
  kind: "pairs",
  pairs: [
    { label: "BP", value: "128/84" },
    { label: "P", value: "88" },
    { label: "T", value: "38.4°C" },
    { label: "Wt", value: "100 kg" },
    { label: "Ht", value: "160 cm" },
    { label: "SpO₂", value: "97%" },
  ],
};

function bundle(o: Partial<ReviewBundle>): ReviewBundle {
  return {
    schemaVersion: 4,
    prescriptionId: "11111111-2222-4333-8444-555555555555",
    encounterId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    clinicalDate: "2026-08-26",
    doctor: DOCTOR,
    location: LOCATION,
    patient: PATIENT,
    template: template(),
    signature: null,
    items: [medicine(1), medicine(2, { display_name: "Sergel", generic_name: "Esomeprazole" })],
    layout: "two-column",
    sections: [],
    ...o,
  } as ReviewBundle;
}

const TYPICAL_SECTIONS: BundleSection[] = [
  text("CHIEF_COMPLAINT", "Chief Complaint", "Fever and sore throat for 3 days"),
  VITALS,
  text("HISTORY", "History", "No diabetes. Hypertension, on medication for 2 years."),
  text("EXAMINATION", "Examination", "Throat congested. Chest clear."),
  list("DIAGNOSIS", "Diagnosis", [{ text: "Acute pharyngitis" }, { text: "Hypertension" }]),
  list("INVESTIGATIONS", "Investigations / Tests", [
    { text: "CBC with ESR", note: "rule out bacterial infection" },
    { text: "Throat swab C/S" },
  ]),
  text("ADVICE", "Advice", "Plenty of warm fluids.\nSalt-water gargle three times daily.\nRest."),
  text("NEXT_VISIT", "Next Visit", "with reports · 2 Sep 2026"),
];

export interface PrintScenario {
  id: string;
  title: string;
  /** What this case is here to prove. Shown beside the sheet in the harness. */
  purpose: string;
  bundle: ReviewBundle;
}

export const PRINT_SCENARIOS: PrintScenario[] = [
  {
    id: "v4-short",
    title: "V4 · short",
    purpose:
      "Two medicines, three sections. The signature and footer must settle at the FOOT of page 1, and it must not tip onto a second sheet.",
    bundle: bundle({ sections: TYPICAL_SECTIONS.slice(0, 3) }),
  },
  {
    id: "v4-typical",
    title: "V4 · typical consultation",
    purpose:
      "Every common module plus investigations, advice and a next visit. The clinical column on the left, the Rx dominant on the right.",
    bundle: bundle({
      sections: TYPICAL_SECTIONS,
      items: [
        medicine(1),
        medicine(2, { display_name: "Sergel", generic_name: "Esomeprazole", strength_text: "20 mg" }),
        medicine(3, {
          display_name: "Fexo",
          generic_name: "Fexofenadine",
          strength_text: "120 mg",
          schedule_text: "0 + 0 + 1",
        }),
      ],
    }),
  },
  {
    id: "v4-long",
    title: "V4 · long, multi-page",
    purpose:
      "Twelve medicines and a long left column. Must paginate: nothing clipped, nothing overlapping, no duplicated medicine, no footer over content, and BOTH columns must continue on page 2.",
    bundle: bundle({
      sections: [
        ...TYPICAL_SECTIONS,
        text(
          "SYMPTOMS",
          "Symptoms",
          "Fever with chills, worse in the evening. Sore throat, painful swallowing. Dry cough at night. Generalised body ache. Reduced appetite for four days. No shortness of breath, no chest pain, no vomiting.",
        ),
        text(
          "ASSESSMENT",
          "Assessment",
          "Likely viral upper respiratory infection with secondary bacterial pharyngitis. Blood pressure not at target on current dose; review after the acute illness settles rather than changing it now.",
        ),
        list("ALLERGY", "Allergies", [{ text: "Penicillin", note: "rash" }]),
        list("LONG_TERM_MEDICINES", "Long-term Medicines", [
          { text: "Amlodipine", note: "5 mg · once daily" },
          { text: "Metformin", note: "500 mg · twice daily" },
        ]),
      ],
      items: Array.from({ length: 12 }, (_, i) =>
        medicine(i + 1, {
          display_name: `Medicine ${i + 1}`,
          generic_name: `Generic ${i + 1}`,
          instructions: i % 3 === 0 ? "খাবারের পর সেবন করুন। পানি বেশি পান করবেন।" : null,
        }),
      ),
    }),
  },
  {
    id: "v4-edge",
    title: "V4 · edge content",
    purpose:
      "A long medicine name, a long Bangla instruction, a quantity of 500g, a long patient name and long advice. Values must print EXACTLY as frozen — 500g stays 500g.",
    bundle: bundle({
      patient: {
        ...PATIENT,
        fullName: "Mosammat Rahima Khatun Chowdhury Begum Sultana",
        patientNumber: "P-000000000124",
      },
      sections: [
        VITALS,
        text(
          "ADVICE",
          "Advice",
          "Reduce sugar to 500g per week and salt to 10g per day.\nWalk 30 minutes daily.\nদৈনিক অন্তত আট গ্লাস পানি পান করুন এবং রাতে দেরি করে খাবেন না।",
        ),
      ],
      items: [
        medicine(1, {
          display_name: "Amoxicillin + Clavulanic Acid Extended Release",
          generic_name: "Amoxicillin trihydrate with potassium clavulanate",
          strength_text: "875 mg + 125 mg",
          quantity_text: "500g",
          instructions:
            "প্রতিদিন সকালে ও রাতে খাবারের ঠিক পরে একটি করে ট্যাবলেট সেবন করুন। কোর্স সম্পূর্ণ করা আবশ্যক, ভালো বোধ করলেও ওষুধ বন্ধ করবেন না।",
        }),
        medicine(2, { display_name: "Zinc", quantity_text: "10g", strength_text: null }),
      ],
    }),
  },
  {
    id: "v4-relabelled",
    title: "V4 · another doctor's labels and order",
    purpose:
      "The SAME clinical content under different frozen labels, in a different order. Proves the paper follows the snapshot, not any current configuration.",
    bundle: bundle({
      sections: [
        text("NEXT_VISIT", "Come Back", "with reports · 2 Sep 2026"),
        list("INVESTIGATIONS", "Lab Work", [{ text: "CBC with ESR" }]),
        text("CHIEF_COMPLAINT", "Presenting Complaint", "Fever and sore throat for 3 days"),
        VITALS,
      ],
    }),
  },
  {
    id: "v4-no-sections",
    title: "V4 · every module off",
    purpose:
      "A doctor who prints nothing but the Rx. There must be no empty left column and no rule down the page — the medicines take the full width.",
    bundle: bundle({ sections: [] }),
  },
  {
    id: "v4-a5",
    title: "V4 · A5, 10 mm margin",
    purpose: "The approved paper and margin, not a hardcoded A4. Two columns on a narrow sheet.",
    bundle: bundle({
      template: template({ paperSize: "A5", marginMm: 10, baseFontPt: 9 }),
      sections: TYPICAL_SECTIONS.slice(0, 5),
    }),
  },
  {
    id: "v4-wide-margin",
    title: "V4 · A4, 25 mm margin",
    purpose: "A wide approved margin must apply to EVERY page, not just the first.",
    bundle: bundle({
      template: template({ marginMm: 25 }),
      sections: TYPICAL_SECTIONS,
      items: Array.from({ length: 9 }, (_, i) => medicine(i + 1, { display_name: `Medicine ${i + 1}` })),
    }),
  },
  {
    id: "v3-historical",
    title: "V3 · historical snapshot",
    purpose:
      "A prescription finalised before Prescription V2. Must render through the V3 document — one column, medicines then tests then advice — and must NOT acquire the two-column layout.",
    bundle: bundle({
      schemaVersion: 3,
      layout: undefined,
      sections: undefined,
      investigations: [
        { position: 1, name: "CBC with ESR", note: "rule out bacterial infection" },
        { position: 2, name: "Throat swab C/S", note: null },
      ],
      advice: "Plenty of warm fluids.\nSalt-water gargle three times daily.\nRest.",
    }),
  },
  {
    id: "v2-historical",
    title: "V2 · oldest snapshot",
    purpose:
      "Older still: no investigations and no advice ever existed on it. Nothing may be back-filled from today's data to make it look complete.",
    bundle: bundle({ schemaVersion: 2, layout: undefined, sections: undefined }),
  },
  {
    id: "unsupported",
    title: "Unknown format",
    purpose:
      "A snapshot from a newer build. Must refuse plainly — never fall back to the V4 document, and never render an empty prescription.",
    bundle: bundle({ schemaVersion: 5 }),
  },
];
