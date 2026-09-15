import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const v4 = readFileSync(
  resolve(root, "src/features/prescriptions/components/document-v4.tsx"),
  "utf8",
);
const v3 = readFileSync(
  resolve(root, "src/features/prescriptions/components/document-v3.tsx"),
  "utf8",
);
const fahrenheitPolicy = readFileSync(
  resolve(root, "supabase/policies/0048_pilot_fahrenheit_prescription_bundle.sql"),
  "utf8",
);

describe("pilot Step 1 prescription corrections", () => {
  it("uses the canonical owner-supplied logo without a background tile", () => {
    expect(v4).toContain('src="/brand/dd-logo-mark-canonical.webp"');
    expect(v4).toContain('data-rx-brand="doctors-diary"');
  });

  it("aligns the first clinical section with medicine row one", () => {
    expect(v4).toContain('style={{ visibility: "hidden" }}');
    expect(v4).toContain("height: u.mm(2)");
  });

  it("centers the current-layout signature and doctor name over one underline", () => {
    expect(v4).toContain('data-rx-signature="centered"');
    expect(v4).toContain('className="flex justify-center"');
    expect(v4).toContain('style={{ width: u.mm(45) }}');
  });

  it("does not redesign legacy v3 signed prescriptions", () => {
    expect(v3).not.toContain('data-rx-brand="doctors-diary"');
    expect(v3).toContain("<SignatureBlock view={view} u={u} signatureUrl={signatureUrl} />");
  });

  it("freezes Fahrenheit only into newly built review bundles and recomputes the digest", () => {
    expect(fahrenheitPolicy).toContain("prescription_review_bundle_v4_celsius");
    expect(fahrenheitPolicy).toContain("|| '°F'");
    expect(fahrenheitPolicy).toContain("sha256(convert_to(v_bundle::text, 'UTF8'))");
    expect(fahrenheitPolicy).toContain("revoke all on function public.prescription_review_bundle_v4_celsius");
  });
});
