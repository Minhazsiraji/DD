import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("Doctor's Diary canonical visual material contract", () => {
  it("defines exactly the shared chrome, panel, record and clinical variants", () => {
    const css = read("src/app/dd-material-system.css");
    for (const variant of ["chrome", "panel", "record", "clinical"]) {
      expect(css).toContain(`.dd-material-${variant}`);
    }
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toContain("@supports not ((backdrop-filter");
  });

  it("keeps child records free of backdrop blur", () => {
    const css = read("src/app/dd-material-system.css");
    const start = css.indexOf(".dd-material-record {");
    const end = css.indexOf(".dd-material-record:hover", start);
    const record = css.slice(start, end);
    expect(record).toContain("backdrop-filter: none !important");
    expect(record).not.toMatch(/backdrop-filter:\s*blur/);
  });

  it("reconciles Appointments, Hand Over and Patients as one panel plus lightweight records", () => {
    expect(read("src/app/(app)/appointments/page.tsx")).toContain("dd-material-panel dd-record-stack");
    expect(read("src/features/appointments/components/appointment-card.tsx")).toContain("dd-material-record");
    expect(read("src/app/(app)/handover/page.tsx")).toContain("dd-material-panel dd-record-stack");
    const patients = read("src/features/patients/components/patient-list.tsx");
    expect(patients).toContain("dd-material-panel");
    expect(patients).toContain("dd-material-record");
  });

  it("keeps Patient Profile safety clinical and Timeline events individually distinct", () => {
    expect(read("src/app/(app)/patients/[id]/page.tsx")).toContain("dd-material-clinical dd-profile-summary");
    const timeline = read("src/features/patients/components/patient-timeline.tsx");
    expect(timeline).toContain("dd-record-stack");
    expect(timeline).toContain("dd-material-record");
  });

  it("uses the same brand/material language for Auth and the public Homepage", () => {
    expect(read("src/app/(auth)/layout.tsx")).toContain("BrandWordmark");
    expect(read("src/features/auth/components/form-parts.tsx")).toContain("dd-material-panel dd-auth-card");
    expect(read("src/components/marketing/marketing-shell.tsx")).toContain("dd-material-chrome");
    const home = read("src/app/page.tsx");
    expect(home).toContain("dd-material-panel dd-public-card");
    expect(home).toContain("dd-material-record");
  });

  it("carries only the authorized Vercel Seoul region configuration", () => {
    const config = JSON.parse(read("vercel.json"));
    expect(config.regions).toEqual(["icn1"]);
    expect(Object.keys(config).sort()).toEqual(["$schema", "regions"].sort());
  });
});
