import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADOPTION_METRICS,
  AI_USAGE_METRICS,
  COST_METRICS,
  DASHBOARD_TABS,
  DOCTOR_COLUMNS,
  OVERVIEW_CARDS,
  PILOT_HEALTH_METRICS,
  SECURITY_METRICS,
} from "./catalog";

/**
 * PROOF THAT THE OWNER DASHBOARD OPENS NO CLINICAL QUERY OR DATA SURFACE.
 *
 * Structural assertions over the source of every dashboard file — the feature
 * module and all seven routes. They are the gate a future change must pass,
 * not a description of today's good behaviour:
 *
 *   • no database access except through an explicitly approved owner-aggregate
 *     RPC (and the approved list is empty today);
 *   • no direct table read of any kind — `.from(` — clinical or otherwise;
 *   • no service-role client;
 *   • no clinical table or clinical field name anywhere;
 *   • every route asserts the existing owner + AAL2 boundary before anything
 *     else, and implements no authority of its own;
 *   • the catalog — everything the owner can see — names nothing clinical.
 *
 * Runtime proof that an owner session reads zero clinical rows remains the job
 * of `scripts/verify-owner-authority.mjs`; this file proves the dashboard never
 * gives such a read anywhere to happen.
 */

const ROOT = process.cwd();
const FEATURE = path.join(ROOT, "src/features/owner/dashboard");
const ROUTES = path.join(ROOT, "src/app/owner/dashboard");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const FILES = [...walk(FEATURE), ...walk(ROUTES)];
const src = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(ROOT, f).replaceAll("\\", "/");

/** Strip comments, so a warning written in prose is not mistaken for code. */
function code(f: string): string {
  return src(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Every clinical table in both the V1 schema and Database V2 P0. The dashboard
 * may name none of them in code.
 */
const CLINICAL_TABLES = [
  "patients",
  "clinical_patients",
  "patient_private_notes",
  "patient_allergies",
  "patient_conditions",
  "patient_medications",
  "patient_alerts",
  "patient_contacts",
  "patient_location_links",
  "patient_documents",
  "clinical_documents",
  "personal_health_documents",
  "encounters",
  "encounter_diagnoses",
  "encounter_investigations",
  "encounter_events",
  "prescriptions",
  "prescription_items",
  "prescription_events",
  "health_subjects",
  "health_subject_access",
  "patient_subject_links",
  "consent_records",
];

/** Field names that would carry clinical payload into an owner surface. */
const FORBIDDEN_FIELDS = [
  "patientId",
  "patient_id",
  "patientName",
  "patient_name",
  "fullName",
  "full_name",
  "diagnosis",
  "diagnoses",
  "chiefComplaint",
  "chief_complaint",
  "transcript",
  "prompt",
  "medicineName",
  "medicine_name",
  "dosage",
  "instructions",
  "clinicalText",
  "clinical_payload",
  "prescriptionText",
];

describe("the dashboard opens no database surface of its own", () => {
  it("covers every dashboard file — the check is not vacuous", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(14);
    expect(FILES.map(rel)).toEqual(
      expect.arrayContaining([
        "src/features/owner/dashboard/sources.ts",
        "src/app/owner/dashboard/layout.tsx",
        "src/app/owner/dashboard/page.tsx",
        "src/app/owner/dashboard/doctors/page.tsx",
      ]),
    );
  });

  it("reads no table directly — no `.from(` anywhere", () => {
    for (const f of FILES) {
      expect(code(f), rel(f)).not.toMatch(/\.from\s*\(/);
    }
  });

  it("calls no RPC outside the approved owner-aggregate list, which is empty today", async () => {
    const { APPROVED_OWNER_AGGREGATE_RPCS } = await import("./sources").catch(() => ({
      // sources.ts is server-only; read the list from source when the import is refused.
      APPROVED_OWNER_AGGREGATE_RPCS: (() => {
        const m = src(path.join(FEATURE, "sources.ts")).match(
          /APPROVED_OWNER_AGGREGATE_RPCS:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/,
        );
        return m ? (m[1].match(/"([^"]+)"/g) ?? []).map((s) => s.slice(1, -1)) : ["<unparsed>"];
      })(),
    }));

    expect(APPROVED_OWNER_AGGREGATE_RPCS).toEqual([]);

    for (const f of FILES) {
      const calls = [...code(f).matchAll(/\.rpc\(\s*["'`]([a-z_]+)["'`]/g)].map((m) => m[1]);
      for (const name of calls) {
        expect(APPROVED_OWNER_AGGREGATE_RPCS, `${rel(f)} calls ${name}`).toContain(name);
      }
    }
  });

  it("does not construct a database client at all yet", () => {
    for (const f of FILES) {
      expect(code(f), rel(f)).not.toMatch(/createSupabaseServerClient|createBrowserClient|createClient\s*\(/);
    }
  });

  it("never reaches the service-role client", () => {
    for (const f of FILES) {
      expect(code(f), rel(f)).not.toMatch(/serviceStorage|supabase\/service|SERVICE_ROLE|db\/admin/);
    }
  });

  it("names no clinical table in code", () => {
    for (const f of FILES) {
      const c = code(f);
      for (const t of CLINICAL_TABLES) {
        expect(c, `${rel(f)} names ${t}`).not.toMatch(new RegExp(`["'\`.]${t}["'\`\\s(]`));
      }
    }
  });

  /**
   * DATA SHAPES, not prose. A clinical field only becomes a data surface as a
   * key, a type member or a property read — `prompt:`, `transcript?:`,
   * `.diagnosis`, `["patient_id"]`. The privacy statement is REQUIRED to name
   * those words in sentences ("never a transcript or prompt"), and a check
   * that failed on it would be deleted by the first person it inconvenienced.
   */
  it("carries no clinical field as a key, type member or property read", () => {
    for (const f of FILES) {
      const c = code(f);
      for (const field of FORBIDDEN_FIELDS) {
        const shapes = [
          new RegExp(`\\.${field}\\b`), //         obj.prompt
          new RegExp(`\\b${field}\\s*\\??\\s*:`), // prompt:  /  prompt?:
          new RegExp(`\\[\\s*["'\`]${field}["'\`]\\s*\\]`), // obj["prompt"]
          new RegExp(`["'\`]${field}["'\`]\\s*:`), //   "prompt":
        ];
        for (const shape of shapes) {
          expect(c, `${rel(f)} carries ${field} as data (${shape})`).not.toMatch(shape);
        }
      }
    }
  });

  it("the privacy check is not vacuous — it catches a clinical field when one is present", () => {
    const planted = "interface Row { doctorRef: string; transcript?: string }\nconst x = row.diagnosis;";
    const hits = FORBIDDEN_FIELDS.filter((field) =>
      [new RegExp(`\\.${field}\\b`), new RegExp(`\\b${field}\\s*\\??\\s*:`)].some((r) => r.test(planted)),
    );
    expect(hits).toEqual(expect.arrayContaining(["transcript", "diagnosis"]));
  });

  it("keeps the source registry server-only", () => {
    expect(src(path.join(FEATURE, "sources.ts"))).toMatch(/^import "server-only";/);
  });
});

describe("the existing owner + AAL2 boundary is preserved, and nothing new replaces it", () => {
  const pages = FILES.filter((f) => /[/\\](page|layout)\.tsx$/.test(f) && f.startsWith(ROUTES));

  it("covers all seven routes and the dashboard layout", () => {
    expect(pages.length).toBe(8);
  });

  /**
   * The FIRST await of ANY kind — not the first awaited call. An earlier
   * version matched `await <name>(`, and so ignored `await props.searchParams`:
   * a mutation that read search params before the guard passed it. Reading the
   * request before authority is established is exactly the ordering this
   * boundary forbids, so any await at all counts.
   */
  it("every route's first await, of any kind, is requirePlatformOwner()", () => {
    for (const f of pages) {
      const body = code(f).slice(code(f).indexOf("export default async function"));
      const firstAwait = body.match(/\bawait\s+([A-Za-z_$][\w$.]*)/);
      expect(firstAwait?.[1], rel(f)).toBe("requirePlatformOwner");
    }
  });

  it("imports that boundary from the one existing authority module", () => {
    for (const f of pages) {
      expect(src(f), rel(f)).toContain('from "@/features/owner/authority"');
    }
  });

  it("implements no alternate authority — no owner RPC, no AAL check of its own", () => {
    for (const f of FILES) {
      const c = code(f);
      expect(c, rel(f)).not.toMatch(/is_platform_owner|getAuthenticatorAssuranceLevel|aal2|isPlatformOwner\(/);
    }
  });

  it("the /owner layout that guards every owner route still exists and still guards", () => {
    const layout = src(path.join(ROOT, "src/app/owner/layout.tsx"));
    expect(layout).toContain("await requirePlatformOwner()");
  });
});

describe("what the owner can see names nothing clinical", () => {
  const ALL = [
    ...OVERVIEW_CARDS,
    ...DOCTOR_COLUMNS,
    ...ADOPTION_METRICS,
    ...AI_USAGE_METRICS,
    ...COST_METRICS,
    ...PILOT_HEALTH_METRICS,
    ...SECURITY_METRICS,
  ];
  const CLINICAL_WORDS = /\b(patient|diagnos|transcript|prompt|medicine name|dosage|symptom|complaint)/i;

  it("no card, column or metric label is clinical content", () => {
    for (const m of ALL) {
      expect(m.label, m.key).not.toMatch(CLINICAL_WORDS);
    }
  });

  it("the only identity on the doctors table identifies a DOCTOR", () => {
    const identity = DOCTOR_COLUMNS.filter((c) => c.identity).map((c) => c.key);
    expect(identity).toEqual(["doctor", "pilotStatus"]);
  });

  it("carries exactly the ten required cards and thirteen required columns", () => {
    expect(OVERVIEW_CARDS.map((c) => c.label)).toEqual([
      "Total Doctors",
      "Active Today",
      "Active 7 Days",
      "Active 30 Days",
      "New Doctors",
      "Consultations",
      "Prescriptions",
      "AI Requests",
      "AI Spend",
      "Voice Minutes",
    ]);
    expect(DOCTOR_COLUMNS.map((c) => c.label)).toEqual([
      "Doctor",
      "Pilot status",
      "Last active",
      "Active days",
      "Sessions",
      "Active minutes",
      "Consultations",
      "Rx",
      "AI requests",
      "Tokens",
      "Voice minutes",
      "AI cost",
      "Estimated time saved",
    ]);
  });

  it("exposes exactly the seven required sections", () => {
    expect(DASHBOARD_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "Doctors",
      "Adoption",
      "AI Usage",
      "Costs",
      "Pilot Health",
      "Security",
    ]);
  });
});
