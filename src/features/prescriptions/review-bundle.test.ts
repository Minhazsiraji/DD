import { describe, it, expect } from "vitest";
import {
  CURRENT_BUNDLE_SCHEMA_VERSION,
  SUPPORTED_BUNDLE_SCHEMA_VERSIONS,
  parseReview,
} from "./review-bundle";
import { toReviewView, toLine } from "./review-view";

/**
 * The canonical bundle, as the client is allowed to treat it.
 *
 * Two properties matter more than the rest:
 *
 *   1. The client PARSES and never CONSTRUCTS. Stage 7A dropped the overload
 *      that accepted browser-supplied snapshot JSON; nothing here may rebuild
 *      its shape and hand it back.
 *   2. An unknown schema FAILS CLOSED. Rendering a newer bundle with older
 *      rules silently drops whatever the newer schema added — and the doctor
 *      would then approve a digest covering content their screen never showed.
 */

const DIGEST = "a".repeat(64);

/**
 * A valid envelope, with any part of it overridden.
 *
 * `bundle` is merged field-by-field rather than replaced, so a test that only
 * cares about `paperSize` does not have to restate a whole prescription.
 */
function envelope(over: Record<string, unknown> = {}): unknown {
  const { bundle: bundleOver, ...envelopeOver } = over as {
    bundle?: Record<string, unknown>;
  };

  const bundle: Record<string, unknown> = {
    schemaVersion: 1,
      prescriptionId: "11111111-1111-4111-8111-111111111111",
      encounterId: "22222222-2222-4222-8222-222222222222",
      doctor: {
        fullName: "Dr Rahima Khatun",
        qualification: "MBBS, FCPS (Medicine)",
        specialization: "Internal Medicine",
        designation: "Consultant",
        bmdcRegistrationNo: "A-12345",
      },
      location: {
        name: "Greenview Chamber",
        address: "12 Kemal Ataturk Ave",
        district: "Dhaka",
        phone: "+8801700000000",
      },
      patient: {
        fullName: "Salma Begum",
        patientNumber: "AR-000001",
        sex: "FEMALE",
        dob: null,
        dobPrecision: "AGE_ONLY",
        approxAgeYears: 38,
        ageRecordedOn: "2026-01-01",
      },
      template: {
        source: "global",
        templateId: "33333333-3333-4333-8333-333333333333",
        name: "Chamber letterhead",
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
        footerText: "Not valid without signature",
        showSignature: true,
      },
      signature: null,
      items: [
        {
          position: 1,
          display_name: "Tab. Napa 500 mg",
          brand_name: "Napa",
          generic_name: "Paracetamol",
          strength_text: "500 mg",
          dose_text: "1 tablet",
          dosage_form: "Tablet",
          route: "Oral",
          schedule_text: "1+0+1",
          duration_text: "7 days",
          quantity_text: "14 tablets",
          food_relation: "After food",
          is_prn: false,
          instructions: "খাবারের পরে খাবেন",
          substitution_allowed: true,
        },
      ],
  };

  return {
    bundle: { ...bundle, ...bundleOver },
    digest: DIGEST,
    expectedSignaturePath: "uid/rx/signature",
    version: 3,
    ...envelopeOver,
  };
}

/** The default template, for tests that vary one switch on it. */
function baseTemplate(): Record<string, unknown> {
  return (envelope() as { bundle: { template: Record<string, unknown> } }).bundle.template;
}

describe("parseReview", () => {
  it("accepts the bundle this build understands", () => {
    const parsed = parseReview(envelope());
    expect(parsed.ok).toBe(true);
  });

  it("fails closed on a schema version from a newer build", () => {
    const parsed = parseReview(envelope({ bundle: { schemaVersion: 2 } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("unsupported-schema");
      if (parsed.reason === "unsupported-schema") expect(parsed.found).toBe(2);
    }
  });

  it("reports an unknown schema as such, not as a pile of field errors", () => {
    // The two need different messages and different fixes: one is "update the
    // app", the other is "something is broken".
    const future = parseReview(envelope({ bundle: { schemaVersion: 99, items: "nonsense" } }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.reason).toBe("unsupported-schema");
  });

  it("rejects a malformed bundle rather than rendering part of it", () => {
    const parsed = parseReview(envelope({ bundle: { patient: { fullName: "x" } } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("malformed");
  });

  it("rejects anything that is not a sha256 digest", () => {
    expect(parseReview(envelope({ digest: "short" })).ok).toBe(false);
    expect(parseReview(envelope({ digest: DIGEST.toUpperCase() })).ok).toBe(false);
  });

  it("rejects a version that could never have been earned", () => {
    expect(parseReview(envelope({ version: 0 })).ok).toBe(false);
  });

  it("declares exactly one supported version, and it is the current one", () => {
    expect(SUPPORTED_BUNDLE_SCHEMA_VERSIONS).toContain(CURRENT_BUNDLE_SCHEMA_VERSION);
  });
});

describe("the client never rewrites the bundle", () => {
  it("carries the digest through untouched", () => {
    const parsed = parseReview(envelope());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.review.digest).toBe(DIGEST);
  });

  it("renders from the bundle without altering it", () => {
    const parsed = parseReview(envelope());
    if (!parsed.ok) throw new Error("unreachable");
    const before = JSON.stringify(parsed.review.bundle);
    toReviewView(parsed.review.bundle, "2026-08-18");
    expect(JSON.stringify(parsed.review.bundle)).toBe(before);
  });
});

describe("toReviewView", () => {
  function view(over: Record<string, unknown> = {}) {
    const parsed = parseReview(envelope(over));
    if (!parsed.ok) throw new Error("fixture did not parse");
    return toReviewView(parsed.review.bundle, "2026-08-18");
  }

  it("uses the template's paper size, never a hardcoded A4", () => {
    expect(view().paperSize).toBe("A4");
    expect(view({ bundle: { template: { ...baseTemplate(), paperSize: "A5" } } }).paperSize).toBe("A5");
  });

  it("keeps strength and dose apart", () => {
    const line = view().lines[0];
    expect(line.strength).toBe("500 mg");
    expect(line.dose).toBe("1 tablet");
  });

  it("preserves Bangla instructions exactly", () => {
    expect(view().lines[0].instructions).toBe("খাবারের পরে খাবেন");
  });

  it("orders medicines by position, whatever order they arrived in", () => {
    const base = envelope() as { bundle: { items: Record<string, unknown>[] } };
    const first = base.bundle.items[0];
    const shuffled = view({
      bundle: {
        items: [
          { ...first, position: 3, display_name: "Third" },
          { ...first, position: 1, display_name: "First" },
          { ...first, position: 2, display_name: "Second" },
        ],
      },
    });
    expect(shuffled.lines.map((l) => l.name)).toEqual(["First", "Second", "Third"]);
  });

  it("hides credentials the template switches off", () => {
    const t = baseTemplate();
    const hidden = view({ bundle: { template: { ...t, showBmdc: false, showSpecialization: false } } });
    expect(hidden.header?.bmdc).toBeNull();
    expect(hidden.header?.credentials).not.toContain("Internal Medicine");
  });

  it("drops the header entirely when the template hides it", () => {
    const t = baseTemplate();
    expect(view({ bundle: { template: { ...t, showHeader: false } } }).header).toBeNull();
  });

  it("distinguishes a hidden signature from an unfrozen one", () => {
    const t = baseTemplate();
    expect(view({ bundle: { template: { ...t, showSignature: false } } }).signature.kind).toBe(
      "hidden",
    );
    // Shown, and nothing frozen yet — the normal 7C-1 state.
    expect(view().signature.kind).toBe("not-frozen");
  });

  it("reports a frozen signature by its path", () => {
    const frozen = view({
      bundle: {
        signature: { objectId: "obj-1", path: "uid/rx/signature", size: 4096, mimetype: "image/png" },
      },
    });
    expect(frozen.signature).toEqual({ kind: "frozen", path: "uid/rx/signature" });
  });

  it("ages the patient from the bundle, not from the clock", () => {
    // Recorded as 38 in 2026-01; still 38 in 2026-08 of the same year. The
    // "~" is the app's mark for an age that was stated rather than dated.
    expect(view().patient.ageSex).toBe("~38y · F");
  });

  it("ages forward when the recorded year has passed", () => {
    expect(view().patient.ageSex).toBe("~38y · F");
    const parsed = parseReview(envelope());
    if (!parsed.ok) throw new Error("unreachable");
    expect(toReviewView(parsed.review.bundle, "2029-08-18").patient.ageSex).toBe("~41y · F");
  });
});

describe("toLine", () => {
  const item = (envelope() as { bundle: { items: Record<string, unknown>[] } }).bundle.items[0];

  it("does not repeat a brand the display name already carries", () => {
    // "Tab. Napa 500 mg" already says Napa; printing it again reads as a
    // second fact.
    expect(toLine(item as never).subtitle).toBe("Paracetamol");
  });

  it("keeps a brand the name does not mention", () => {
    expect(toLine({ ...item, display_name: "Paracetamol 500" } as never).subtitle).toBe("Napa");
  });

  it("drops the subtitle when it would say nothing new", () => {
    expect(
      toLine({ ...item, brand_name: null, generic_name: null } as never).subtitle,
    ).toBeNull();
  });

  it("treats whitespace-only fields as absent", () => {
    const blank = toLine({ ...item, dose_text: "   ", quantity_text: "" } as never);
    expect(blank.dose).toBeNull();
    expect(blank.quantity).toBeNull();
  });
});
