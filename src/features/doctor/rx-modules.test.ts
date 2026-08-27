import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  LABEL_MAX,
  RX_MODULES,
  RX_MODULE_LABEL,
  RX_MODULE_SOURCE,
  labelProblem,
  rxModulesPayloadSchema,
  withPositions,
  type RxModulesPayload,
} from "./rx-modules";

const full = (): RxModulesPayload =>
  RX_MODULES.map((module) => ({
    module,
    useDuringConsultation: true,
    showOnPrint: false,
    printLabel: null,
  }));

/**
 * The settings screen writes a heading onto a clinical document and an order
 * that decides what a prescription looks like. Both rules live in the database;
 * these tests hold the browser-side copy to the same shape, so a doctor is told
 * at the keyboard rather than after a round trip — and so the copy can never
 * become the WEAKER of the two.
 */
describe("the module list matches the database", () => {
  it("has every module the rx_module enum has, and no others", async () => {
    const sql = await readFile(
      path.resolve("supabase/policies/0028_prescription_v2.sql"),
      "utf8",
    );
    // `default_rx_modules()` lists every module exactly once.
    for (const m of RX_MODULES) {
      expect(sql.includes(`'${m}'::public.rx_module`), `${m} missing from SQL`).toBe(true);
    }
    const inSql = [...sql.matchAll(/'([A-Z_]+)'::public\.rx_module/g)].map((m) => m[1]);
    expect(new Set(inSql)).toEqual(new Set(RX_MODULES));
  });

  it("the built-in headings match rx_module_label()", async () => {
    const sql = await readFile(
      path.resolve("supabase/policies/0029_review_bundle_v4.sql"),
      "utf8",
    );
    for (const m of RX_MODULES) {
      const heading = RX_MODULE_LABEL[m];
      expect(
        sql.includes(`then '${heading}'`),
        `${m}: the screen says "${heading}" and the database does not`,
      ).toBe(true);
    }
  });

  it("every module says where its content comes from", () => {
    // A toggle whose meaning depends on the source is a toggle that has to say
    // what the source is.
    for (const m of RX_MODULES) {
      expect(RX_MODULE_SOURCE[m]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("a custom heading is held to the database's rule", () => {
  it("accepts an ordinary heading, and blank meaning 'use the built-in one'", () => {
    expect(labelProblem("Presenting Complaint")).toBeNull();
    expect(labelProblem("")).toBeNull();
    expect(labelProblem("   ")).toBeNull();
  });

  it("refuses anything that could carry markup, rather than escaping it", () => {
    /**
     * Refused, not escaped: escaping is a decision made in one renderer and
     * forgotten in the next, and this string becomes a heading on paper.
     */
    for (const bad of ['<b>Notes', 'Notes & more', 'Say "hello"', "a > b"]) {
      expect(labelProblem(bad), bad).not.toBeNull();
    }
  });

  it("refuses a heading longer than the database allows", () => {
    expect(labelProblem("x".repeat(LABEL_MAX))).toBeNull();
    expect(labelProblem("x".repeat(LABEL_MAX + 1))).not.toBeNull();
  });

  it("uses the same length and character rule the SQL does", async () => {
    const sql = await readFile(
      path.resolve("supabase/policies/0028_prescription_v2.sql"),
      "utf8",
    );
    expect(sql).toMatch(new RegExp(`length\\(v_label\\) > ${LABEL_MAX}`));
    expect(sql).toMatch(/v_label ~ '\[<>&"\]'/);
  });
});

describe("the whole screen saves as one payload", () => {
  it("accepts exactly the twelve sections", () => {
    expect(rxModulesPayloadSchema.safeParse(full()).success).toBe(true);
  });

  it("refuses a partial save — a half-applied reorder is a state nobody asked for", () => {
    expect(rxModulesPayloadSchema.safeParse(full().slice(0, 5)).success).toBe(false);
  });

  it("refuses a duplicated section", () => {
    const rows = full();
    rows[1] = { ...rows[0]! };
    expect(rxModulesPayloadSchema.safeParse(rows).success).toBe(false);
  });

  it("refuses a heading the database would refuse", () => {
    const rows = full();
    rows[0] = { ...rows[0]!, printLabel: "<script>" };
    expect(rxModulesPayloadSchema.safeParse(rows).success).toBe(false);
  });
});

describe("position is derived from the order, never sent up from the browser", () => {
  it("numbers the sections in the order they appear", () => {
    const rows = full();
    const positions = withPositions(rows).map((r) => r.position);
    expect(positions).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  });

  it("gives no two sections the same position", () => {
    // A tie would leave the printed order down to a tiebreak nobody chose.
    const positions = withPositions(full()).map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("reordering the array is the whole reorder", () => {
    const rows = full();
    const swapped = [rows[3]!, ...rows.filter((_, i) => i !== 3)];
    const out = withPositions(swapped);
    expect(out[0]!.module).toBe(rows[3]!.module);
    expect(out[0]!.position).toBe(10);
  });

  it("an empty heading is stored as null, so the built-in one prints", () => {
    const rows = full();
    rows[0] = { ...rows[0]!, printLabel: "" };
    rows[1] = { ...rows[1]!, printLabel: "Presenting Complaint" };
    const out = withPositions(rows);
    expect(out[0]!.printLabel).toBeNull();
    expect(out[1]!.printLabel).toBe("Presenting Complaint");
  });
});

describe("the settings screen cannot reach a signed prescription", () => {
  it("the page says so, because it is the first thing a doctor should be able to answer", async () => {
    const page = await readFile(
      path.resolve("src/app/(app)/settings/prescription/sections/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/affects new prescriptions only/i);
  });

  it("no write here touches a prescription, an encounter or a patient", async () => {
    const actions = (
      await readFile(path.resolve("src/features/doctor/rx-module-actions.ts"), "utf8")
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const table of ["prescriptions", "encounters", "patients", "prescription_items"]) {
      expect(actions.includes(table), `rx-module-actions.ts must not touch ${table}`).toBe(false);
    }
    // And it never accepts a doctor id — the database resolves that from auth.uid().
    expect(actions).not.toMatch(/doctorId|doctor_profile_id|p_doctor/);
  });
});
