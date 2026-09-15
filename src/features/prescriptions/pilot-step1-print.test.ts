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
const parts = readFileSync(
  resolve(root, "src/features/prescriptions/components/prescription-parts.tsx"),
  "utf8",
);
const fahrenheitPolicy = readFileSync(
  resolve(root, "supabase/policies/0048_pilot_fahrenheit_prescription_bundle.sql"),
  "utf8",
);

describe("pilot Step 1 prescription corrections", () => {
  it("keeps Doctor's Diary branding out of the V4 prescription header and reserves chamber-logo space", () => {
    expect(v4).not.toContain("<PrescriptionBrand");
    expect(v4).not.toContain('data-rx-brand="doctors-diary"');
    expect(v4).toContain("<PrescriptionHeader view={view} u={u} reserveClinicLogoSlot />");
    expect(parts).toContain('data-rx-clinic-logo-slot="reserved"');
    expect(parts).toContain("width: u.mm(12), height: u.mm(12)");
  });

  it("aligns the first clinical section with medicine row one", () => {
    expect(v4).toContain('style={{ visibility: "hidden" }}');
    expect(v4).toContain("height: u.mm(2)");
  });

  it("restores the current-layout signature and doctor name to the right bottom", () => {
    expect(v4).toContain("<SignatureBlock view={view} u={u} signatureUrl={signatureUrl} />");
    expect(v4).not.toContain('data-rx-signature="centered"');
    expect(parts).toContain('className="flex justify-end"');
    expect(parts).toContain('style={{ width: u.mm(45), marginBottom: u.mm(1) }}');
  });

  it("adds the V4 platform footer with AgentSiraji attribution and Doctor's Diary identity", () => {
    expect(v4).toContain("<PrescriptionFooter view={view} u={u} platformAttribution />");
    expect(parts).toContain('data-rx-platform-footer="doctors-diary"');
    expect(parts).toContain("Developed by: ©AgentSiraji");
    expect(parts).toContain("Contact: business@agentsiraji.com");
    expect(parts).toContain('src="/brand/dd-logo-mark-canonical.webp"');
    expect(parts).toContain("Care · Record · Connect");
  });

  it("does not redesign legacy v3 signed prescriptions", () => {
    expect(v3).not.toContain("reserveClinicLogoSlot");
    expect(v3).not.toContain("platformAttribution");
    expect(v3).not.toContain('data-rx-platform-footer="doctors-diary"');
    expect(v3).toContain("<PrescriptionHeader view={view} u={u} />");
    expect(v3).toContain("<SignatureBlock view={view} u={u} signatureUrl={signatureUrl} />");
    expect(v3).toContain("<PrescriptionFooter view={view} u={u} />");
  });

  it("freezes Fahrenheit only into newly built review bundles and recomputes the digest", () => {
    expect(fahrenheitPolicy).toContain("prescription_review_bundle_v4_celsius");
    expect(fahrenheitPolicy).toContain("|| '°F'");
    expect(fahrenheitPolicy).toContain("sha256(convert_to(v_bundle::text, 'UTF8'))");
    expect(fahrenheitPolicy).toContain("revoke all on function public.prescription_review_bundle_v4_celsius");
  });
});
