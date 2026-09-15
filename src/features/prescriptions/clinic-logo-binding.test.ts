import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ReviewBundle } from "./review-bundle";
import { toDocumentChrome } from "./review-view";

function bundle(clinicLogo: ReviewBundle["clinicLogo"], showClinicLogo = false): ReviewBundle {
  return {
    schemaVersion: 5,
    prescriptionId: "11111111-1111-4111-8111-111111111111",
    encounterId: "22222222-2222-4222-8222-222222222222",
    clinicalDate: "2026-09-15",
    doctor: {
      fullName: "Dr Test",
      qualification: "MBBS",
      specialization: null,
      designation: null,
      bmdcRegistrationNo: "A-1",
    },
    location: {
      name: "Savar CLINIC",
      address: "Savar",
      district: "Dhaka",
      phone: null,
    },
    patient: {
      fullName: "Synthetic Patient",
      patientNumber: "SYN-1",
      sex: "FEMALE",
      dob: null,
      dobPrecision: "AGE_ONLY",
      approxAgeYears: 30,
      ageRecordedOn: "2026-09-15",
    },
    template: {
      source: "global",
      templateId: "33333333-3333-4333-8333-333333333333",
      name: "Personal Chamber",
      paperSize: "A4",
      marginMm: 15,
      baseFontPt: 11,
      showHeader: true,
      showClinicLogo,
      clinicNameOverride: null,
      headerNote: null,
      showQualification: true,
      showSpecialization: true,
      showDesignation: true,
      showBmdc: true,
      showChamberAddress: true,
      showChamberPhone: true,
      showFooter: false,
      footerText: null,
      showSignature: false,
    },
    signature: null,
    clinicLogo,
    items: [],
    layout: "two-column",
    sections: [],
  };
}

describe("M3 clinic logo location binding", () => {
  it("renders an attested Savar clinic logo even when the global layout fallback flag is false", () => {
    const logo = {
      objectId: "logo-object-1",
      path: "savar/logo-old.png",
      size: "1234",
      mimetype: "image/png",
    };

    const chrome = toDocumentChrome(bundle(logo, false));

    expect(chrome.templateName).toBe("Personal Chamber");
    expect(chrome.templateSource).toBe("global");
    expect(chrome.header?.clinicName).toBe("Savar CLINIC");
    expect(chrome.clinicLogo).toEqual({ kind: "frozen", path: "savar/logo-old.png" });
  });

  it("renders a location with no snapshotted logo cleanly without a placeholder", () => {
    expect(toDocumentChrome(bundle(null, true)).clinicLogo).toEqual({ kind: "hidden" });
  });

  it("builds the canonical logo identity from the selected practice location, not the template flag", () => {
    const sql = readFileSync(
      "supabase/policies/0050_clinic_logo_location_authority.sql",
      "utf8",
    );

    expect(sql).toContain("where l.id = p_practice_location_id");
    expect(sql).toContain("l.prescription_logo_path");
    expect(sql).not.toContain("showClinicLogo')::boolean");
    expect(sql).not.toContain("practice_location_id = v_");
  });

  it("attests null for no-logo locations but fails closed for a configured missing object", () => {
    const sql = readFileSync(
      "supabase/policies/0050_clinic_logo_location_authority.sql",
      "utf8",
    );

    expect(sql).toContain("if nullif(btrim(coalesce(v_logo_path, '')), '') is not null then");
    expect(sql).toContain("v_logo := null;");
    expect(sql).toContain("raise exception 'CLINIC_LOGO_UNAVAILABLE'");
    expect(sql).toContain("o.bucket_id = 'clinic-assets'");
  });

  it("keeps finalized logo resolution bound to the immutable prescription snapshot", () => {
    const sql0049 = readFileSync(
      "supabase/policies/0049_clinic_logo_prescription_identity.sql",
      "utf8",
    );
    const assetAction = readFileSync("src/features/prescriptions/asset-actions.ts", "utf8");

    expect(sql0049).toContain("if v_rx.status = 'FINALIZED' then");
    expect(sql0049).toContain("v_rx.review_bundle_snapshot -> 'clinicLogo' ->> 'path'");
    expect(assetAction).toContain("const frozen = parsed.data.clinicLogo?.path ?? null");
    expect(assetAction).toContain("if (!frozen || frozen !== requestedPath) return { ok: false, url: null }");
  });
});
