import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentChrome } from "./review-view";
import { ClinicLogoHeader } from "./components/clinic-logo-header";
import { PHYSICAL_UNITS } from "./components/prescription-parts";

const headerSource = readFileSync(
  "src/features/prescriptions/components/clinic-logo-header.tsx",
  "utf8",
);
const reviewSheetSource = readFileSync(
  "src/features/prescriptions/components/review-sheet.tsx",
  "utf8",
);
const printSheetSource = readFileSync(
  "src/features/prescriptions/components/print-sheet.tsx",
  "utf8",
);

function chrome(clinicLogo: DocumentChrome["clinicLogo"]): DocumentChrome {
  return {
    clinicalDate: "2026-09-16",
    paperSize: "A4",
    marginMm: 15,
    baseFontPt: 11,
    header: {
      clinicName: "P-I1 QA Hospital",
      addressLine: "Synthetic address, Dhaka",
      phone: "01000000000",
      headerNote: null,
      doctorName: "Dr Synthetic",
      credentials: ["MBBS"],
      bmdc: "SYN-1",
    },
    patient: { fullName: "Synthetic Patient", patientNumber: "SYN-1", ageSex: "30y / F" },
    lines: [],
    footerText: null,
    showFooter: false,
    signature: { kind: "hidden" },
    clinicLogo,
    templateName: "Personal Chamber",
    templateSource: "global",
  };
}

describe("M3 final clinic logo header visual contract", () => {
  it("pairs the logo immediately with the chamber name on one centered row", () => {
    expect(headerSource).toContain(
      'className="flex min-w-0 flex-nowrap items-center justify-end"',
    );
    expect(headerSource).toContain(
      "style={{ gap: showLogo && h.clinicName ? u.mm(2) : 0 }}",
    );
    expect(headerSource.indexOf("data-rx-clinic-logo-image")).toBeLessThan(
      headerSource.indexOf("{h.clinicName}"),
    );
  });

  it("renders the attested synthetic hospital asset as a real printable image", () => {
    const signedUrl = "https://synthetic.supabase.co/storage/v1/object/sign/clinic-assets/hospital/logo.png?token=synthetic";
    const markup = renderToStaticMarkup(
      React.createElement(ClinicLogoHeader, {
        view: chrome({ kind: "frozen", path: "hospital/logo.png" }),
        u: PHYSICAL_UNITS,
        clinicLogoUrl: signedUrl,
      }),
    );

    expect(markup).toContain("data-rx-clinic-logo-image");
    expect(markup).toContain(`src="${signedUrl.replaceAll("&", "&amp;")}"`);
    expect(markup).toContain("P-I1 QA Hospital");
    expect(headerSource).toContain("<img");
    expect(headerSource).toContain('className="shrink-0 object-contain"');
    expect(headerSource).toContain("width: u.mm(12)");
    expect(headerSource).toContain("height: u.mm(12)");
    expect(headerSource).not.toContain("backgroundImage");
    expect(headerSource).not.toContain("backgroundSize");
  });

  it("uses the same corrected document renderer for review and native print", () => {
    expect(reviewSheetSource).toContain("<PrescriptionDocument");
    expect(printSheetSource).toContain("<PrescriptionDocument");
    expect(printSheetSource).toContain("data-print-root");
  });

  it("renders a logo-free chamber without an empty image placeholder", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ClinicLogoHeader, {
        view: chrome({ kind: "hidden" }),
        u: PHYSICAL_UNITS,
        clinicLogoUrl: null,
      }),
    );

    expect(markup).toContain("P-I1 QA Hospital");
    expect(markup).not.toContain("data-rx-clinic-logo-image");
    expect(headerSource).not.toContain('data-rx-clinic-logo-slot="reserved"');
  });

  it("keeps address and phone directly below the paired identity row", () => {
    const row = headerSource.indexOf("showLogo || h.clinicName");
    const address = headerSource.indexOf("{h.addressLine ? (");
    const phone = headerSource.indexOf("{h.phone ?");

    expect(row).toBeGreaterThan(-1);
    expect(address).toBeGreaterThan(row);
    expect(phone).toBeGreaterThan(address);
    expect(headerSource).toContain('className="ml-auto min-w-0 text-right"');
  });

  it("keeps long clinic names attached to the logo without forcing the logo to shrink", () => {
    expect(headerSource).toContain("flex-nowrap");
    expect(headerSource).toContain('className="shrink-0 object-contain"');
    expect(headerSource).toContain('className="min-w-0 font-semibold"');
  });
});
