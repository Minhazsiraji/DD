import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Corrections, held in place from the source side.
 *
 * `db:verify:correction` proves the behaviour against a real database and is
 * the authority. These are the cheap, always-run guards for the ways it could
 * be undone by an edit that looks harmless: the reason reaching paper, the old
 * medicines being helpfully copied forward, or a lost response turning into a
 * second correction.
 */

const POLICY = path.resolve("supabase/policies/0023_prescription_correction.sql");
const BOUNDARY = path.resolve("supabase/policies/0024_correction_trust_boundary.sql");
const PARTS = path.resolve("src/features/prescriptions/components/prescription-parts.tsx");
const SHEET = path.resolve("src/features/prescriptions/components/print-sheet.tsx");
const BANNER = path.resolve("src/features/prescriptions/components/correction-banner.tsx");
const CONTROL = path.resolve("src/features/prescriptions/components/write-correction.tsx");
const ACTIONS = path.resolve("src/features/prescriptions/actions.ts");

async function read(file: string) {
  return readFile(file, "utf8");
}

/** Source with comments stripped — these are about what the code does. */
async function code(file: string) {
  return (await read(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(--|\/\/)[^\n]*/g, "");
}

describe("the correction reason never reaches paper", () => {
  it("is not rendered by the shared clinical parts", async () => {
    /**
     * `prescription-parts.tsx` is the ONE interpreter both sheets use, so if
     * the reason is absent here it cannot print — whatever the screen does.
     */
    const parts = await code(PARTS);
    expect(parts).not.toMatch(/replacementReason|replacesPrescriptionId|correctionReason/);
  });

  it("is not reachable from the print sheet", async () => {
    const sheet = await code(SHEET);
    expect(sheet).not.toMatch(/replacement|correction|replaces/i);
  });

  it("the lineage banners are marked as never printing", async () => {
    const banner = await read(BANNER);
    // Both the failure state and the lineage block carry it.
    expect(banner.match(/data-print-hidden/g)?.length).toBeGreaterThanOrEqual(2);
    // …and the banner is not rendered from inside the sheet component.
    expect(banner).not.toMatch(/<PrintSheet|<ReviewSheet/);
  });

  it("the reason is owner-gated in the RPC, not in React", async () => {
    const sql = await code(POLICY);
    // Every place the reason is returned must be behind the ownership CASE.
    const returns = sql.match(/'reason',[^\n]*/g) ?? [];
    expect(returns.length).toBeGreaterThan(0);
    for (const line of returns) {
      expect(line).toMatch(/case when v_owner then/);
    }
    expect(sql).not.toMatch(/'replacementReason',\s*v_rx\.replacement_reason/);
  });
});

describe("a correction starts blank", () => {
  it("the control never receives or copies the previous medicines", async () => {
    /**
     * The Alpha decision, and the reason for it: the dose being corrected may
     * be the wrong one, so pre-filling puts the mistake back on screen as a
     * default to accept.
     *
     * Asserted on what the component can REACH, not on loose words — an earlier
     * version of this test matched Tailwind's `items-center`.
     */
    const control = await code(CONTROL);
    expect(control).not.toMatch(/MedicineRow|ReviewBundle|prescription_items|\bline\./);
    expect(control).not.toMatch(/copyMedicines|prefill|prePopulate|initialItems/i);

    // The action it calls carries only ids and a reason — no medicines.
    const call = control.slice(control.indexOf("startCorrectionAction("));
    expect(call.slice(0, 200)).toMatch(/\{\s*prescriptionId,\s*reason\s*\}/);
  });

  it("is labelled as a new prescription, never as editing the old one", async () => {
    /**
     * Comment-stripped: the doc comment above the component NAMES the forbidden
     * words in order to reject them, and scanning raw source failed on the
     * explanation rather than on the interface.
     */
    const control = await code(CONTROL);
    expect(control).toMatch(/Write corrected prescription/);
    for (const forbidden of ["Edit prescription", "Modify", "Reopen", "Change prescription"]) {
      expect(control).not.toMatch(new RegExp(forbidden, "i"));
    }
    // And it says plainly what it does instead.
    expect(control).toMatch(/A correction is a new prescription/);
  });

  it("requires a trimmed, bounded reason before it will submit", async () => {
    const control = await code(CONTROL);
    expect(control).toMatch(/reason\.trim\(\)/);
    expect(control).toMatch(/disabled=\{busy \|\| trimmed === ""\}/);
    // The same 500 the column's CHECK constraint enforces.
    expect(control).toMatch(/MAX_REASON = 500/);
  });
});

describe("the prescription being corrected is the only identifier", () => {
  /**
   * The trust boundary. Lineage was checked against a browser-supplied
   * prescription id while the write ran against a browser-supplied ENCOUNTER
   * id, so the two halves of one clinical relationship could disagree. Nothing
   * was cross-doctor — both paths re-checked ownership — but "which
   * prescription is this a correction of" must not be assembled from two things
   * the browser sent.
   */
  it("the component sends no encounter id", async () => {
    const control = await code(CONTROL);
    expect(control).not.toMatch(/encounterId/);
  });

  it("the action accepts no encounter id", async () => {
    const actions = await code(ACTIONS);
    const fn = actions.slice(
      actions.indexOf("export async function startCorrectionAction"),
      actions.indexOf("export async function addMedicineAction"),
    );
    expect(fn).not.toMatch(/encounterId|p_encounter_id/);
    // One identifier, and the RPC derives the rest from the row.
    expect(fn).toMatch(/p_prescription_id: prescriptionId/);
    expect(fn).toMatch(/rpc\("start_prescription_correction"/);
  });

  it("the other door is shut: opening by encounter takes no reason", async () => {
    /**
     * `open_prescription` used to accept a replacement reason, and supplying it
     * turned an ordinary open into a correction of whatever it inferred was the
     * newest unreplaced finalised prescription on that encounter. Removed, not
     * defaulted — an unused default is still a parameter a caller may supply.
     */
    const actions = await code(ACTIONS);
    const fn = actions.slice(
      actions.indexOf("export async function openPrescriptionAction"),
      actions.indexOf("export async function startCorrectionAction"),
    );
    expect(fn).not.toMatch(/replacementReason|p_replacement_reason/);
  });

  it("the RPC derives the encounter from the row it was handed", async () => {
    const sql = await code(BOUNDARY);
    const fn = sql.slice(sql.indexOf("function public.start_prescription_correction"));
    const params = fn.slice(fn.indexOf("(") + 1, fn.indexOf(")"));
    expect(params).not.toMatch(/encounter/i);

    // Every field of the new row is copied from `v_rx`, never from a parameter.
    expect(fn).toMatch(/values \(\s*v_rx\.encounter_id, v_rx\.owner_doctor_id, v_rx\.patient_id,/);
    // And it replaces exactly the row it was named, not an inferred "latest".
    expect(fn).toMatch(/replaces_prescription_id[\s\S]{0,400}p_prescription_id,/);
    expect(fn).not.toMatch(/order by finalized_at desc/);
  });
});

describe("a lost response does not become a second correction", () => {
  it("re-reads the authoritative lineage before reporting failure", async () => {
    const actions = await code(ACTIONS);
    const fn = actions.slice(
      actions.indexOf("export async function startCorrectionAction"),
      actions.indexOf("export async function addMedicineAction"),
    );

    // Looks BEFORE writing, and again AFTER a failure.
    expect(fn.match(/getPrescriptionLineage/g)?.length).toBeGreaterThanOrEqual(2);
    // The three outcomes stay apart: exists → open, absent → retry, unknown → stop.
    expect(fn).toMatch(/kind: "unconfirmed"/);
    expect(fn).toMatch(/kind: "refused"/);
  });

  it("blocks the retry button on an unconfirmed outcome", async () => {
    const control = await code(CONTROL);
    /**
     * Not disabled — ABSENT. A disabled button invites a reload and a second
     * attempt, and a duplicate correction is exactly what cannot be allowed to
     * happen while the first one's fate is unknown.
     */
    expect(control).toMatch(/error\?\.blocking \? null :/);
    expect(control).toMatch(/result\.kind === "unconfirmed"/);
  });

  it("takes the reason from the doctor, never a default", async () => {
    const actions = await code(ACTIONS);
    const fn = actions.slice(
      actions.indexOf("export async function startCorrectionAction"),
      actions.indexOf("export async function addMedicineAction"),
    );
    expect(fn).toMatch(/\.min\(1,/);
    expect(fn).toMatch(/\.max\(500,/);
    // No fallback string that would satisfy the constraint on the doctor's behalf.
    expect(fn).not.toMatch(/reason\s*(\?\?|\|\|)\s*["'`]/);
  });
});

describe("the handover list distinguishes a superseded sheet", () => {
  it("marks it in the database, rather than hiding it", async () => {
    const sql = await code(POLICY);
    expect(sql).toMatch(/is_superseded\s+boolean/);
    expect(sql).toMatch(/superseded_by\s+uuid/);
    /**
     * History must stay complete: the superseded row is still returned. A
     * filter that removed it would lose what was issued that day.
     */
    expect(sql).not.toMatch(/not exists\s*\(\s*select 1 from public\.prescriptions r/);
  });

  it("only hands over an id the reader could open", async () => {
    const sql = await code(POLICY);
    /**
     * The SELECT expression itself, not a proximity match on the column name —
     * the declaration in `returns table` and the gating in the body are far
     * apart, and the distance is not the property under test.
     */
    expect(sql).toMatch(
      /case\s+when\s+coalesce\(p\.owner_doctor_id = public\.current_doctor_id\(\), false\)\s+or public\.may_hand_over_prescription\(r\.id\)\s+then r\.id\s+end/,
    );
  });
});
