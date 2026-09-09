import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Every assertion in this suite reasons about repository source text (CSS blocks
// delimited by "}\n", TSX class strings), never about line-ending bytes. On a
// CRLF working tree (Windows, core.autocrlf=true) those "\n" delimiters would
// not match. Canonicalise the representation at the read boundary so the same
// committed content gives the same result on an LF or CRLF checkout.
const read = (file: string) =>
  readFileSync(path.resolve(file), "utf8").replace(/\r\n/g, "\n");

function walkTsx(dir: string): string[] {
  return readdirSync(path.resolve(dir)).flatMap((name) => {
    const absolute = path.resolve(dir, name);
    const relative = path.relative(process.cwd(), absolute);
    if (statSync(absolute).isDirectory()) return walkTsx(relative);
    return name.endsWith(".tsx") ? [relative] : [];
  });
}

const publicFiles = [
  "src/app/page.tsx",
  "src/app/features/page.tsx",
  "src/app/security/page.tsx",
  "src/app/faq/page.tsx",
  "src/app/how-it-works/page.tsx",
  "src/app/pricing/page.tsx",
  "src/app/contact/page.tsx",
  "src/app/dr/[slug]/page.tsx",
  "src/app/dr/[slug]/book/page.tsx",
  "src/app/dr/[slug]/book/confirmed/page.tsx",
  "src/components/marketing/marketing-shell.tsx",
];

describe("Doctor's Diary shared visual system reconciliation", () => {
  it("keeps one canonical four-variant material system with safe fallbacks", () => {
    const css = read("src/app/dd-material-system.css");
    for (const variant of ["chrome", "panel", "record", "clinical"]) {
      expect(css).toContain(`.dd-material-${variant}`);
    }
    expect(css).toContain(".dd-material-record.dd-record-pearl");
    expect(css).toContain(".dd-material-panel.dd-panel-pearl");
    expect(css).toContain(".dd-public-feature-card");
    expect(css).toContain("prefers-reduced-transparency: reduce");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("@supports not ((backdrop-filter");
  });

  it("never adds backdrop blur to repeated record variants", () => {
    const css = read("src/app/dd-material-system.css");
    for (const selector of [".dd-material-record {", ".dd-material-record.dd-record-pearl {"]) {
      const start = css.indexOf(selector);
      const end = css.indexOf("}\n", start) + 2;
      const block = css.slice(start, end);
      expect(block).toContain("backdrop-filter: none !important");
      expect(block).not.toMatch(/backdrop-filter:\s*blur/);
    }
  });

  it("locks the violet primary and aqua secondary CTA hierarchy at the shared primitive", () => {
    const css = read("src/app/canonical-brand.css");
    expect(css).toContain(".dd-primary,");
    expect(css).toContain("a.bg-brand,");
    expect(css).toContain("button.bg-brand,");
    expect(css).toContain(".dd-secondary {");
    expect(css).toContain("transition: transform .16s ease");
    expect(css).toContain(".dd-secondary:hover");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("reconciles the Homepage hero, workflow, benefits and Founding Doctors from shared variants", () => {
    const home = read("src/app/page.tsx");
    expect(home).toContain('className="dd-brand-teal">More patient.</span>');
    expect(home).toContain("dd-primary inline-flex min-h-11");
    expect(home).toContain("dd-secondary inline-flex min-h-11");
    expect(home).toContain("dd-app-panel dd-material-panel dd-panel-pearl dd-public-card");
    expect(home).toContain("dd-quick-row dd-quick-control flex min-h-11 items-center gap-2.5 rounded-xl px-3");
    expect(home).toContain("dd-record-pearl dd-public-feature-card");
    expect(home).toContain("dd-material-panel dd-panel-pearl rounded-[2rem]");
  });

  it("removes legacy teal/opaque marketing recipes from every public route", () => {
    for (const file of publicFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/bg-teal-600|bg-teal-50|text-teal-700|border-teal-200|bg-slate-950/);
      expect(source, file).not.toMatch(/rounded-3xl[^\n\"]*border border-slate-200 bg-white/);
      expect(source, file).not.toMatch(/rounded-\[2rem\][^\n\"]*bg-white/);
    }
  });

  it("uses shared primary/secondary CTAs across public and auth entry points", () => {
    const shell = read("src/components/marketing/marketing-shell.tsx");
    expect(shell).toMatch(/href="\/login" className="dd-secondary/);
    expect(shell).toMatch(/href="\/signup" className="dd-primary/);
    const pricing = read("src/app/pricing/page.tsx");
    expect(pricing).toMatch(/href="\/signup" className="dd-primary/);
    expect(pricing).toMatch(/href="\/contact" className="dd-secondary/);
    const booking = read("src/app/dr/[slug]/book/page.tsx");
    expect(booking).toContain('className="dd-secondary min-h-11 w-full');
    expect(booking).toContain('className="dd-primary min-h-11 w-full');
    expect(read("src/features/auth/components/form-parts.tsx")).toContain('className="dd-primary inline-flex h-11 w-full');
  });

  it("propagates neutral pearl glass to every active material-record consumer", () => {
    const files = walkTsx("src");
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(".test.tsx")) continue;
      const lines = read(file).split("\n");
      lines.forEach((line, index) => {
        if (line.includes("dd-material-record") && !line.includes("dd-record-pearl")) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("removes broad aqua body modifiers while keeping aqua for true controls", () => {
    const material = read("src/app/dd-material-system.css");
    expect(material).not.toContain("dd-record-aqua");
    expect(material).not.toContain("dd-panel-aqua");
    expect(material).not.toContain("dd-mat-aqua-record");
    const recordStart = material.indexOf(".dd-material-record.dd-record-pearl {");
    const recordEnd = material.indexOf("}\n", recordStart) + 2;
    expect(material.slice(recordStart, recordEnd)).not.toContain("var(--dd-aqua");
    const secondary = read("src/app/canonical-brand.css");
    expect(secondary).toContain(".dd-secondary {");
    expect(secondary).toContain("var(--dd-aqua-a)");
  });

  it("shares one Quick Action visual primitive between Dashboard and Homepage workflow rows", () => {
    const liquid = read("src/app/app-unified-liquid.css");
    expect(liquid).toContain(".dd-quick-control {");
    expect(liquid).toContain(".dd-quick-control:hover");
    expect(read("src/app/(app)/dashboard/page.tsx")).toContain("dd-quick-row dd-quick-control");
    const home = read("src/app/page.tsx");
    expect(home).toContain("dd-quick-row dd-quick-control flex min-h-11 items-center gap-2.5 rounded-xl px-3");
    expect(home).not.toContain("dd-workflow-step");
    expect(home).toContain("size-4 shrink-0 place-items-center text-[11px] font-bold text-brand");
  });

  it("keeps Finder candidate glass neutral and removes the visible development footer", () => {
    const liquid = read("src/app/app-unified-liquid.css");
    expect(liquid).toContain(".dd-app-panel.dd-finder-results");
    expect(liquid).toContain("rgba(250,251,255,.72)");
    expect(liquid).not.toMatch(/dd-finder-results[\s\S]{0,420}var\(--dd-aqua/);
    const auth = read("src/app/(auth)/layout.tsx");
    expect(auth).not.toContain("Development build. Use fake data only");
    expect(auth).not.toContain("not approved for real patient information");
  });

  it("uses whole-record lift only where the whole record is an interaction target", () => {
    expect(read("src/app/(app)/handover/page.tsx")).toContain("dd-record-interactive");
    expect(read("src/features/patients/components/patient-list.tsx")).toContain("dd-record-interactive");
    expect(read("src/features/patients/components/patient-timeline.tsx")).toContain("dd-record-interactive");
    expect(read("src/app/dr/[slug]/book/page.tsx")).toContain("dd-record-interactive");
    expect(read("src/features/appointments/components/appointment-card.tsx")).not.toContain("dd-record-interactive");
    expect(read("src/features/queue/components/queue-card.tsx")).not.toContain("dd-record-interactive");
  });

  it("reconciles all repeated M1 records under blurred parents without changing clinical safety", () => {
    expect(read("src/app/(app)/appointments/page.tsx")).toContain("dd-material-panel dd-record-stack");
    expect(read("src/app/(app)/handover/page.tsx")).toContain("dd-material-panel dd-record-stack");
    expect(read("src/features/patients/components/patient-list.tsx")).toContain("dd-material-panel");
    expect(read("src/features/patients/components/patient-timeline.tsx")).toContain("dd-record-stack");
    expect(read("src/features/queue/components/queue-board.tsx")).toContain("dd-material-panel rounded-[28px]");
    expect(read("src/features/queue/components/queue-card.tsx")).toContain("dd-material-record dd-record-pearl");
    const profile = read("src/app/(app)/patients/[id]/page.tsx");
    expect(profile).toContain("dd-material-clinical dd-profile-summary");
    expect(profile).toContain("bg-danger-soft");
  });

  it("keeps Auth and shared chrome in the same DD product family", () => {
    expect(read("src/app/(auth)/layout.tsx")).toContain("BrandWordmark");
    expect(read("src/features/auth/components/form-parts.tsx")).toContain("dd-material-panel dd-auth-card");
    expect(read("src/components/layout/top-bar.tsx")).toContain("dd-material-chrome");
    expect(read("src/components/layout/desktop-sidebar.tsx")).toContain("dd-material-chrome");
    expect(read("src/components/layout/mobile-bottom-nav.tsx")).toContain("dd-material-chrome");
  });

  it("preserves only the authorized Vercel Seoul region configuration", () => {
    const config = JSON.parse(read("vercel.json"));
    expect(config.regions).toEqual(["icn1"]);
    expect(Object.keys(config).sort()).toEqual(["$schema", "regions"].sort());
  });
});
