import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const headerSource = readFileSync(
  "src/features/prescriptions/components/clinic-logo-header.tsx",
  "utf8",
);

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

  it("renders the attested clinic asset as a real printable image", () => {
    expect(headerSource).toContain("<img");
    expect(headerSource).toContain("data-rx-clinic-logo-image");
    expect(headerSource).toContain("src={resolvedUrl ?? undefined}");
    expect(headerSource).toContain('className="shrink-0 object-contain"');
    expect(headerSource).toContain("width: u.mm(12)");
    expect(headerSource).toContain("height: u.mm(12)");
    expect(headerSource).not.toContain("backgroundImage");
    expect(headerSource).not.toContain("backgroundSize");
  });

  it("does not reserve an empty logo slot when the clinic has no logo", () => {
    expect(headerSource).not.toContain('data-rx-clinic-logo-slot="reserved"');
    expect(headerSource).toContain("{showLogo ? (");
    expect(headerSource).toContain(") : null}");
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
