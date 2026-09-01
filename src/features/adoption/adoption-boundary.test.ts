import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Boundaries a routine edit could quietly cross. Behaviour that needs a
 * database is proven in `scripts/verify-owner-metrics.mjs`; these do not.
 */
const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

const sqlCode = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const METRICS_SQL = "supabase/policies/0042_owner_adoption_metrics.sql";
const SETUP_PAGE = "src/app/(app)/settings/setup/page.tsx";
const BILLING_PAGE = "src/app/(app)/settings/billing/page.tsx";
const OWNER_ADOPTION = "src/app/owner/adoption/page.tsx";
const BRIDGE = "src/features/adoption/components/public-profile-bridge.tsx";
const CHECKLIST = "src/features/adoption/components/setup-checklist.tsx";
const NUDGE = "src/features/adoption/components/setup-nudge.tsx";
const COPY_LINK = "src/features/adoption/components/copy-profile-link.tsx";
const QUERIES = "src/features/adoption/queries.ts";

describe("owner metrics are counts, and only counts", () => {
  const code = sqlCode(source(METRICS_SQL));

  it("is gated on the one platform authority", () => {
    expect(code).toContain("public.is_platform_owner()");
    expect(code).toContain("NOT_PLATFORM_OWNER");
  });

  it("takes no parameter, so there is nothing to probe", () => {
    expect(code).toMatch(/create or replace function public\.owner_adoption_metrics\(\)/);
  });

  it("projects an aggregate and nothing else", () => {
    /*
     * Checked on the VALUE EXPRESSIONS, not on the metric names —
     * `profilesWithSlug` is a count of profiles that have a slug, not a slug.
     * Every subquery in the payload must project an aggregate, so there is no
     * shape in which a doctor id, a name or a slug could reach the caller.
     *
     * `status, count(*) as n` is the one non-count projection and it is the
     * grouped feed for jsonb_object_agg — a status is a category, not an
     * identity.
     */
    const projections = [...code.matchAll(/\(\s*select\s+([\s\S]*?)\s+from/g)].map((m) =>
      m[1]!.replace(/\s+/g, " ").trim(),
    );
    expect(projections.length).toBeGreaterThan(4);
    for (const projection of projections) {
      expect(projection, `projection "${projection}" is not an aggregate`).toMatch(
        /^(count\(|coalesce\(jsonb_object_agg|status, count\(\*\) as n$)/,
      );
    }
  });

  it("reads one clinical table for one aggregate and nothing else", () => {
    for (const table of [
      "patients",
      "prescriptions",
      "prescription_items",
      "appointments",
      "queue_entries",
      "investigation_orders",
      "documents",
    ]) {
      expect(code, `metrics must not read ${table}`).not.toContain(`public.${table}`);
    }
    const encounterReads = code.match(/public\.encounters/g) ?? [];
    expect(encounterReads.length).toBe(1);
    expect(code).toMatch(/count\(distinct owner_doctor_id\) from public\.encounters/);
  });

  it("writes nothing", () => {
    expect(code).not.toMatch(/\b(insert|update|delete|drop|truncate)\s+/i);
  });

  it("is revoked from anon before it is granted", () => {
    expect(code).toContain(
      "revoke all on function public.owner_adoption_metrics() from public, anon",
    );
    expect(code).toContain(
      "grant execute on function public.owner_adoption_metrics() to authenticated",
    );
  });
});

describe("the owner console shows no clinical content", () => {
  const page = source(OWNER_ADOPTION);

  it("has no clinical field to render, by contract", () => {
    /*
     * Asserted on the metrics interface rather than on the page's words. The
     * page legitimately SAYS "prescription" — in the sentence promising it
     * reads none — and a test that cannot tell a promise from a payload would
     * force that promise to be deleted to stay green.
     *
     * `withFirstConsultation` is the one clinically-derived metric, and it is
     * a count of DOCTORS; 0042's header says why that is the boundary.
     */
    const metrics = source("src/features/owner/metrics.ts");
    const contract = metrics.slice(
      metrics.indexOf("interface AdoptionMetrics"),
      metrics.indexOf("export type MetricsResult"),
    );
    const fields = [...contract.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!);

    expect(fields).toContain("withFirstConsultation");
    for (const field of fields) {
      if (field === "withFirstConsultation") continue;
      expect(field, `metric field ${field} sounds clinical`).not.toMatch(
        /patient|encounter|consultation|prescription|diagnos|vital/i,
      );
    }

    // And the page renders nothing that is not in that contract.
    for (const used of [...page.matchAll(/\bm\.(\w+)/g)].map((x) => x[1]!)) {
      expect(fields, `page reads m.${used}, which is not a metric`).toContain(used);
    }
  });

  it("says plainly what it does not read", () => {
    expect(page).toContain("no patient detail is read");
  });

  it("degrades to a message rather than to zeros when the policy is not applied", () => {
    expect(page).toContain("not available on this database yet");
    expect(page).toContain("owner_adoption_metrics()");
  });
});

describe("adoption never gates clinical work", () => {
  it("blocks nothing — no redirect and no notFound in the setup path", () => {
    const page = source(SETUP_PAGE);
    expect(page).not.toContain("redirect(");
    expect(page).not.toContain("notFound(");
  });

  it("says on the checklist that none of it is required to see patients", () => {
    expect(source(CHECKLIST)).toContain("None of this is required to see patients");
  });

  it("keeps the dashboard prompt to one inline element with no modal", () => {
    const nudge = source(NUDGE);
    expect(nudge).not.toMatch(/Dialog|Modal|Sheet|role="dialog"/);
    expect(nudge).toContain("if (!nextStep) return null");
  });

  it("never lets a failed setup read take the dashboard down", () => {
    expect(source("src/app/(app)/dashboard/page.tsx")).toContain(
      "getSetupProgress().catch(() => null)",
    );
  });

  it("reads existence rather than rows for the clinical checks", () => {
    const queries = source(QUERIES);
    expect(queries).toContain('count: "exact", head: true');
    /*
     * The doctor's OWN name is read here and that is fine — it is the name on
     * the checklist. What must never appear is a patient's identity or any
     * consultation content.
     */
    expect(queries).not.toMatch(/patient_number|chief_complaints|diagnos|assessment/);
    expect(queries).not.toContain('.select("*")');
  });
});

describe("the public profile bridge changes nothing", () => {
  const bridge = source(BRIDGE);

  it("has no form, no server action and no handler", () => {
    /*
     * A bare `action=` would match SectionHeader's action SLOT, which is where
     * the visibility badge is rendered. What matters is that no form and no
     * server action is reachable from this card at all.
     */
    expect(bridge).not.toContain("<form");
    expect(bridge).not.toContain("formAction");
    expect(bridge).not.toContain('"use server"');
    expect(bridge).not.toMatch(/onClick|onSubmit/);
  });

  it("routes visibility and booking to the screens that own them", () => {
    expect(bridge).toContain('href="/settings/professional"');
    expect(bridge).toContain('href="/settings/booking"');
    expect(bridge).toContain('href="/settings/professional/preview"');
  });

  it("states that a public profile carries nothing clinical", () => {
    expect(bridge).toContain("never shows a patient");
  });

  it("takes the origin from the browser rather than hard-coding a domain", () => {
    const copy = source(COPY_LINK);
    expect(copy).toContain("window.location.origin");
    expect(copy).not.toMatch(/https?:\/\//);
  });

  it("builds the profile link from the doctor's own slug on the /dr route", () => {
    expect(source(SETUP_PAGE)).toContain("snapshot.slug");
    expect(bridge).toContain("`/dr/${slug}`");
  });
});

describe("nothing hard-codes one country", () => {
  it("keeps the taka sign out of the commercial pages", () => {
    for (const file of [BILLING_PAGE, OWNER_ADOPTION, SETUP_PAGE]) {
      expect(source(file), `${file} hard-codes a currency symbol`).not.toContain("৳");
    }
  });

  it("labels the payment amount with the configured currency code", () => {
    const billing = source(BILLING_PAGE);
    expect(billing).toContain("Amount ({cur.code})");
    expect(billing).not.toContain("Amount (BDT)");
  });

  it("routes every rendered price through the catalog", () => {
    const billing = source(BILLING_PAGE);
    expect(billing).toContain("formatMoney");
    expect(billing).toContain("@/features/commercial/catalog");
  });

  it("names no regulator or gateway in the commercial layer", () => {
    for (const file of [
      "src/features/commercial/catalog.ts",
      "src/features/commercial/state.ts",
      "src/features/commercial/entitlements.ts",
    ]) {
      expect(source(file), file).not.toMatch(/BMDC|SSLCOMMERZ|bKash|Nagad/i);
    }
  });
});

describe("public booking context is untouched by this change", () => {
  it("keeps one reader for booking config rather than forking it", () => {
    const queries = source("src/features/booking-settings/queries.ts");
    expect(queries).toContain("getBookingConfigResult");
    expect(queries).toContain("return (await getBookingConfigResult()).chambers;");
    const rpcCalls = queries.match(/supabase\.rpc\("doctor_booking_config"\)/g) ?? [];
    expect(rpcCalls.length, "one reader, not two").toBe(1);
  });

  it("adds no SQL touching public booking or chamber context", () => {
    const code = sqlCode(source(METRICS_SQL));
    for (const fn of [
      "public_doctor_profile",
      "public_booking_slots",
      "create_public_booking",
      "save_doctor_booking_settings",
    ]) {
      expect(code, `metrics must not redefine ${fn}`).not.toContain(fn);
    }
  });
});

describe("the adoption surfaces are responsive", () => {
  it("lets every card shrink inside a phone-width column", () => {
    for (const file of [CHECKLIST, BRIDGE, "src/features/commercial/components/plan-card.tsx"]) {
      expect(source(file), file).toContain("min-w-0");
    }
  });

  it("stacks the nudge instead of forcing intrinsic width", () => {
    const nudge = source(NUDGE);
    expect(nudge).toContain("flex-wrap");
    expect(nudge).toContain("min-w-0");
  });

  it("keeps touch targets at or above 44px on every control it adds", () => {
    for (const file of [BRIDGE, COPY_LINK, BILLING_PAGE]) {
      expect(source(file), `${file} has a control under 44px`).toMatch(/h-11/);
    }
    // Checklist rows are links, sized by a minimum height rather than a fixed one.
    expect(source(CHECKLIST)).toContain("min-h-11");
  });

  it("never communicates a setup state by colour alone", () => {
    const checklist = source(CHECKLIST);
    expect(checklist).toContain("STATE_WORD");
    expect(checklist).toMatch(/Couldn't check/);
    expect(source(BRIDGE)).toMatch(/Not bookable/);
  });
});
