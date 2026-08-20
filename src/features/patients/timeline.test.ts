import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The patient's clinical history, held honest from the source side.
 *
 * `db:verify:history` and `db:verify:api` prove the boundary against a real
 * database and the real API. These are the cheap guards for the two ways this
 * screen can lie: claiming a module is connected when it is not, and showing a
 * short history that looks complete when a query failed.
 */

const TIMELINE = path.resolve("src/features/patients/timeline.ts");
const COMPONENT = path.resolve("src/features/patients/components/patient-timeline.tsx");

async function read(file: string) {
  return readFile(file, "utf8");
}
/**
 * Source with comments stripped — these are about behaviour, not prose.
 * Handles SQL `--` too: the policy file's own comment names the column it
 * deliberately omits, and scanning raw text failed on the explanation.
 */
async function code(file: string) {
  return (await read(file))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(\/\/|--)[^\n]*/g, "");
}

/**
 * The flags, read from source rather than imported.
 *
 * `timeline.ts` carries `import "server-only"`, which throws outside a Server
 * Component — so the module cannot be imported here at all. Parsing the literal
 * asserts the same property: what the file actually declares.
 */
async function availability(): Promise<Record<string, boolean>> {
  const src = await code(TIMELINE);
  const block = src.slice(
    src.indexOf("TIMELINE_AVAILABLE"),
    src.indexOf("};", src.indexOf("TIMELINE_AVAILABLE")),
  );
  const flags: Record<string, boolean> = {};
  for (const [, key, value] of block.matchAll(/(\w+):\s*(true|false)/g)) {
    flags[key!] = value === "true";
  }
  return flags;
}

describe("a filter is available only when it is really connected", () => {
  it("every event type has an availability flag", async () => {
    const flags = await availability();
    const src = await code(TIMELINE);
    const types = [...src.matchAll(/^\s+"(\w+)",$/gm)].map((m) => m[1]!);
    expect(types.length).toBeGreaterThan(4);
    for (const t of types) expect(flags).toHaveProperty(t);
  });

  it("consultation and prescription are connected", async () => {
    const flags = await availability();
    expect(flags.consultation).toBe(true);
    expect(flags.prescription).toBe(true);
  });

  it("modules with no table behind them stay false", async () => {
    /**
     * `document` and `followup` have no table at all; `investigation` has
     * orders but no results and no detail route. A flag here is a promise that
     * the data is queried and the empty state means "nothing happened".
     */
    const flags = await availability();
    expect(flags.document).toBe(false);
    expect(flags.followup).toBe(false);
    expect(flags.investigation).toBe(false);
  });

  it("each available type is actually queried", async () => {
    const src = await code(TIMELINE);
    // A flag flipped without a query is the exact defect this stage fixed.
    expect(src).toMatch(/from\("encounters"\)/);
    expect(src).toMatch(/rpc\("patient_prescription_history"/);
    expect(src).toMatch(/from\("appointments"\)/);
  });
});

describe("an incomplete history says so", () => {
  it("reports failed sources instead of only logging them", async () => {
    const src = await code(TIMELINE);
    /**
     * The old shape returned a bare array, so a failed query logged a line and
     * produced a shorter history that looked complete. A doctor cannot tell
     * "no prescriptions" from "prescriptions could not be loaded".
     */
    expect(src).toMatch(/missing\.push\("appointments"\)/);
    expect(src).toMatch(/missing\.push\("consultations"\)/);
    expect(src).toMatch(/missing\.push\("prescriptions"\)/);
    expect(src).toMatch(/return \{\s*events:/);
  });

  it("a refusal is not a failure", async () => {
    const src = await code(TIMELINE);
    /**
     * Reception is refused the doctor-only history by design. Reporting that
     * as a broken timeline would cry wolf on every patient page they open.
     */
    expect(src).toMatch(/not a doctor/i);
  });

  it("the screen warns above the events, not below them", async () => {
    const src = await read(COMPONENT);
    const alertAt = src.indexOf('role="alert"');
    const listAt = src.indexOf("events.map");
    expect(alertAt).toBeGreaterThan(-1);
    expect(alertAt).toBeLessThan(listAt);
    expect(src).toMatch(/history is incomplete/i);
  });
});

describe("events are stable and open somewhere real", () => {
  it("ids are deterministic and namespaced by type", async () => {
    const src = await code(TIMELINE);
    for (const shape of [
      /`registration-\$\{/,
      /`appointment-\$\{/,
      /`consultation-\$\{/,
      /`prescription-\$\{/,
    ]) {
      expect(src).toMatch(shape);
    }
    // Nothing random or clock-based: an id must survive a reload.
    expect(src).not.toMatch(/randomUUID|Math\.random|Date\.now\(\)/);
  });

  it("prescriptions are timestamped by when they were ISSUED", async () => {
    const src = await code(TIMELINE);
    /**
     * `finalized_at`, never `created_at` and never now(). Otherwise approving a
     * long-open draft moves an old event, or every event moves on every load.
     */
    expect(src).toMatch(/occurredAt: row\.finalized_at/);
    expect(src).toMatch(/occurredAt: row\.started_at/);
  });

  it("only FINALIZED prescriptions become history", async () => {
    const sql = await code(path.resolve("supabase/policies/0025_patient_history.sql"));
    expect(sql).toMatch(/p\.status = 'FINALIZED'/);
    expect(sql).toMatch(/owner_doctor_id = v_doctor/);
    // Whose history it is comes from the session, never from a parameter.
    expect(sql).not.toMatch(/p_doctor|p_owner/);
  });

  it("the correction reason never enters the history payload", async () => {
    /**
     * Comments stripped: the function's own doc comment NAMES the column in
     * order to say it is deliberately absent, and scanning raw text failed on
     * the explanation rather than on the behaviour.
     */
    const sql = await code(path.resolve("supabase/policies/0025_patient_history.sql"));
    const body = sql.slice(sql.indexOf("returns table"), sql.indexOf("$$;"));
    expect(body).not.toMatch(/replacement_reason/);

    const src = await code(TIMELINE);
    expect(src).not.toMatch(/replacementReason|replacement_reason/);
  });

  it("links point at the canonical immutable record", async () => {
    const src = await code(TIMELINE);
    expect(src).toMatch(/href: `\/prescription\/\$\{row\.prescription_id\}`/);
    // A `null` href renders a plain entry rather than a link that 404s.
    expect(src).toMatch(/href: null/);
  });

  it("lineage is shown as a word, never colour alone", async () => {
    const src = await code(TIMELINE);
    expect(src).toMatch(/badge: superseded \? "Superseded"/);
    const component = await code(COMPONENT);
    expect(component).toMatch(/\{e\.badge\}/);
  });
});
