import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_TABS, PARTICIPATION_COLUMNS, PILOT_STATUS_TILES, resolveCohort } from "./catalog";

/**
 * PROOF THAT THE OWNER DASHBOARD OPENS NO CLINICAL QUERY OR DATA SURFACE.
 *
 * Structural assertions over the source of every dashboard file — the feature
 * module and all seven routes. They are the gate a future change has to pass,
 * not a description of today's good behaviour:
 *
 *   • no direct table read of any kind — `.from(` — clinical or otherwise;
 *   • no RPC outside the approved O1-F owner aggregate list;
 *   • the database client is constructed in exactly one file, `sources.ts`;
 *   • no service-role client anywhere;
 *   • no clinical table or clinical field name anywhere;
 *   • no doctor-shaped identifier accepted from a URL;
 *   • every route asserts the existing owner + AAL2 boundary before anything
 *     else, and implements no authority of its own;
 *   • the Owner shell imports no clinical shell, context or navigation;
 *   • nothing renders sample, mock or demo data;
 *   • the catalog — everything the owner can see — names nothing clinical.
 *
 * Runtime proof that an owner session reads zero clinical rows belongs to
 * O1-F's own verifiers; this file proves the dashboard gives such a read
 * nowhere to happen.
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
 * The complete owner-facing surface O1-F grants to `authenticated` in
 * migration 0047 (blob 357771e3ef0ff822958a8f99bb949f4f8382378d).
 */
const F_OWNER_GRANTS = [
  "owner_pilot_status",
  "owner_pilot_cohort_detail",
  "owner_doctor_activity",
  "owner_activity_summary",
  "owner_service_usage_summary",
  "pilot_participation_state",
  "admin_pilot_cohort_upsert",
  "admin_pilot_participation_set",
  "admin_pilot_event_add",
  "admin_pilot_consent_set",
];

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
  "investigation_orders",
  "investigation_results",
  "health_subjects",
  "health_subject_access",
  "patient_subject_links",
  "consent_records",
  "ai_sessions",
];

/** Field names that would carry clinical or identifying payload into the owner plane. */
const FORBIDDEN_FIELDS = [
  "patientId",
  "patient_id",
  "patientName",
  "patient_name",
  "encounterId",
  "encounter_id",
  "prescriptionId",
  "prescription_id",
  "investigationId",
  "investigation_id",
  "diagnosis",
  "diagnoses",
  "chiefComplaint",
  "chief_complaint",
  "transcript",
  "prompt",
  "completion",
  "medicineName",
  "medicine_name",
  "dosage",
  "instructions",
  "clinicalText",
  "clinical_payload",
  "prescriptionText",
  "operationId",
  "operation_id",
  "grantId",
  "grant_id",
  "proposalId",
  "proposal_id",
  "rawAudio",
  "raw_audio",
];

describe("the dashboard opens no database surface of its own", () => {
  it("covers every dashboard file — the check is not vacuous", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(18);
    expect(FILES.map(rel)).toEqual(
      expect.arrayContaining([
        "src/features/owner/dashboard/sources.ts",
        "src/features/owner/dashboard/contract.ts",
        "src/features/owner/dashboard/cost.ts",
        "src/app/owner/dashboard/layout.tsx",
        "src/app/owner/dashboard/page.tsx",
        "src/app/owner/dashboard/doctors/page.tsx",
        "src/app/owner/dashboard/security/page.tsx",
      ]),
    );
  });

  it("reads no table directly — no `.from(` anywhere", () => {
    for (const f of FILES) {
      expect(code(f), rel(f)).not.toMatch(/\.from\s*\(/);
    }
  });

  /**
   * Two halves, because one `.rpc()` call in `sources.ts` takes its name as a
   * parameter. A regex cannot read that name, so the test checks the thing that
   * actually constrains it instead: the parameter's TYPE. Every other call
   * site must name an approved function as a literal.
   */
  it("calls no RPC outside the approved owner-aggregate list", () => {
    const approved = approvedList();
    expect(approved.length).toBeGreaterThan(0);

    for (const f of FILES) {
      for (const m of code(f).matchAll(/\.rpc\(\s*([^,)]+)/g)) {
        const arg = m[1].trim();
        const literal = arg.match(/^["'`]([a-z_]+)["'`]$/);
        if (literal) {
          expect(approved, `${rel(f)} calls ${literal[1]}`).toContain(literal[1]);
          continue;
        }
        // A non-literal name is allowed only where the type pins it down.
        expect(rel(f), `${rel(f)} calls .rpc(${arg}) with a computed name`).toBe(
          "src/features/owner/dashboard/sources.ts",
        );
        expect(code(f)).toMatch(new RegExp(`${arg}\\s*:\\s*ApprovedOwnerRpc`));
      }
    }

    // And every caller of the wrapper names an approved function outright.
    for (const f of FILES) {
      for (const m of code(f).matchAll(/callOwnerRpc<[^>]*>\(\s*["'`]([a-z_]+)["'`]/g)) {
        expect(approved, `${rel(f)} calls ${m[1]}`).toContain(m[1]);
      }
    }
  });

  it("the approved list is a subset of what O1-F actually grants", () => {
    for (const name of approvedList()) expect(F_OWNER_GRANTS, name).toContain(name);
  });

  it("never names the per-doctor lookup, the control-plane identity surface or any admin mutator", () => {
    const excluded = F_OWNER_GRANTS.filter((n) => !approvedList().includes(n));
    expect(excluded).toEqual(
      expect.arrayContaining(["owner_doctor_activity", "pilot_participation_state", "admin_pilot_consent_set"]),
    );
    for (const f of FILES) {
      const c = code(f);
      for (const name of excluded) expect(c, `${rel(f)} references ${name}`).not.toContain(name);
    }
  });

  it("constructs a database client in exactly one file", () => {
    const constructs = FILES.filter((f) =>
      /createSupabaseServerClient|createBrowserClient|createServerClient|createClient\s*\(/.test(code(f)),
    ).map(rel);
    expect(constructs).toEqual(["src/features/owner/dashboard/sources.ts"]);
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
   * those words in sentences ("never a transcript or prompt"), and a check that
   * failed on it would be deleted by the first person it inconvenienced.
   */
  it("carries no clinical field as a key, type member or property read", () => {
    for (const f of FILES) {
      const c = code(f);
      for (const field of FORBIDDEN_FIELDS) {
        const shapes = [
          new RegExp(`\\.${field}\\b`),
          new RegExp(`\\b${field}\\s*\\??\\s*:`),
          new RegExp(`\\[\\s*["'\`]${field}["'\`]\\s*\\]`),
          new RegExp(`["'\`]${field}["'\`]\\s*:`),
        ];
        for (const shape of shapes) {
          expect(c, `${rel(f)} carries ${field} as data (${shape})`).not.toMatch(shape);
        }
      }
    }
  });

  it("the privacy check is not vacuous — it catches a clinical field when one is present", () => {
    const planted = "interface Row { participationId: string; transcript?: string }\nconst x = row.diagnosis;";
    const hits = FORBIDDEN_FIELDS.filter((field) =>
      [new RegExp(`\\.${field}\\b`), new RegExp(`\\b${field}\\s*\\??\\s*:`)].some((r) => r.test(planted)),
    );
    expect(hits).toEqual(expect.arrayContaining(["transcript", "diagnosis"]));
  });

  it("keeps the source registry server-only", () => {
    expect(src(path.join(FEATURE, "sources.ts"))).toMatch(/^import "server-only";/);
  });

  it("renders no sample, mock or demo data", () => {
    for (const f of FILES) {
      const c = code(f);
      expect(c, rel(f)).not.toMatch(/@\/mocks|mockData|sampleData|demoDoctors|FAKE_|fixtures?\//i);
    }
  });
});

/** The approved list, read from source so the test cannot import a server-only module. */
function approvedList(): string[] {
  const m = src(path.join(FEATURE, "sources.ts")).match(/APPROVED_OWNER_AGGREGATE_RPCS\s*=\s*\[([^\]]*)\]/);
  return m ? (m[1].match(/"([^"]+)"/g) ?? []).map((s) => s.slice(1, -1)) : [];
}

describe("no arbitrary doctor can be selected or probed", () => {
  it("accepts no doctor-shaped identifier from a URL", () => {
    for (const f of FILES) {
      const c = code(f);
      expect(c, rel(f)).not.toMatch(/params\s*\[\s*["'`](id|doctorId|doctor_id|participationId)["'`]\s*\]/);
      expect(c, rel(f)).not.toMatch(/searchParams\.(get\s*\(\s*["'`])?(id|doctorId|doctor)/);
    }
  });

  it("reads exactly one identifier from the URL, and it is a cohort", () => {
    const catalog = code(path.join(FEATURE, "catalog.ts"));
    expect(catalog).toContain('export const COHORT_PARAM = "cohort"');
    // The resolver only ever returns a value the source itself published.
    expect(resolveCohort({ cohort: "NOT_A_REAL_COHORT" }, ["PILOT_A"])).toBe("PILOT_A");
    expect(resolveCohort({ cohort: "PILOT_B" }, ["PILOT_A", "PILOT_B"])).toBe("PILOT_B");
    expect(resolveCohort({ cohort: "PILOT_A" }, [])).toBeNull();
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

  it("implements no alternate authority — no owner table, role, RPC or AAL check of its own", () => {
    for (const f of FILES) {
      const c = code(f);
      expect(c, rel(f)).not.toMatch(/is_platform_owner|getAuthenticatorAssuranceLevel|isPlatformOwner\(/);
      expect(c, rel(f)).not.toMatch(/user_metadata|app_metadata|practice_location_members/);
    }
  });

  it("the /owner layout that guards every owner route still exists and still guards", () => {
    const layout = src(path.join(ROOT, "src/app/owner/layout.tsx"));
    expect(layout).toContain("await requirePlatformOwner()");
  });
});

describe("the owner shell stays out of the clinical shell", () => {
  const CLINICAL_IMPORTS = [
    "@/features/patients",
    "@/features/encounters",
    "@/features/prescriptions",
    "@/features/queue",
    "@/features/appointments",
    "@/features/investigations",
    "@/components/clinical",
    "active-location",
    "PatientSearch",
    "QuickActionMenu",
    "BottomNav",
    "AppSidebar",
    "TopBar",
  ];

  it("imports no clinical feature, context, navigation or shell", () => {
    for (const f of FILES) {
      const c = code(f);
      for (const name of CLINICAL_IMPORTS) {
        expect(c, `${rel(f)} imports ${name}`).not.toContain(name);
      }
    }
  });

  it("lives outside the clinical route group", () => {
    for (const f of FILES.filter((x) => x.startsWith(ROUTES))) {
      expect(rel(f)).toMatch(/^src\/app\/owner\/dashboard\//);
    }
  });
});

describe("owner styling cannot reach the prescription print surface", () => {
  it("declares no print rule and no global stylesheet", () => {
    for (const f of FILES) {
      const c = code(f);
      expect(c, rel(f)).not.toMatch(/@media\s+print|print:|\.css["'`]/);
    }
  });
});

describe("what the owner can see names nothing clinical", () => {
  const ALL = [...PILOT_STATUS_TILES, ...PARTICIPATION_COLUMNS];
  const CLINICAL_WORDS = /\b(patient|diagnos|transcript|prompt|medicine|dosage|symptom|complaint|prescription)/i;

  it("no tile or column label is clinical content", () => {
    for (const m of ALL) expect(m.label, m.key).not.toMatch(CLINICAL_WORDS);
  });

  it("the only identity on the participation table is a pilot participation", () => {
    const identity = PARTICIPATION_COLUMNS.filter((c) => c.identity).map((c) => c.key);
    expect(identity).toEqual(["participation", "lifecycle", "enrolledOn", "measurementStatus"]);
    expect(PARTICIPATION_COLUMNS.map((c) => c.key)).not.toContain("doctorName");
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
