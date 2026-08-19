import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The handover boundary, held in place from the source side.
 *
 * `db:verify:handover` proves the behaviour against a real database and is the
 * authority. These are the cheap, always-run guards for the ways it could be
 * undone by an edit that looks harmless: the reason text creeping back onto the
 * wire, the UI becoming the thing that decides who may read what, or the front
 * desk being handed a doctor-only route.
 */

const POLICY = path.resolve("supabase/policies/0022_prescription_handover.sql");
const COMPONENT = path.resolve(
  "src/features/prescriptions/components/finalized-prescription.tsx",
);

async function read(file: string) {
  return readFile(file, "utf8");
}

/** Source with comments stripped — these tests are about what the code does. */
async function code(file: string) {
  return (await read(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

describe("the correction reason does not reach the front desk", () => {
  it("is gated on ownership inside the RPC, not in React", async () => {
    const sql = await code(POLICY);

    /**
     * The field must be wrapped in a CASE on `v_owner`. A bare
     * `'replacementReason', v_rx.replacement_reason` is the pre-7C-3C shape
     * that handed "allergy discovered" to whoever was at the desk.
     */
    expect(sql).toMatch(/'replacementReason',\s*case when v_owner then/);
    expect(sql).not.toMatch(/'replacementReason',\s*v_rx\.replacement_reason/);
  });

  it("decides ownership from the database, never from a parameter", async () => {
    const sql = await code(POLICY);
    expect(sql).toMatch(/v_owner\s*:=\s*coalesce\(\s*v_rx\.owner_doctor_id = public\.current_doctor_id\(\)/);

    /**
     * `coalesce(..., false)` is load-bearing, not decoration:
     * `current_doctor_id()` is NULL for a receptionist, so the comparison is
     * NULL rather than false and `not (NULL or false)` is NULL — a guard that
     * never fires. That exact trap once handed a DRAFT to the front desk.
     */
    expect(sql).toMatch(/coalesce\([^)]*current_doctor_id\(\)\s*,\s*false\)/);

    // No caller-supplied role, viewer or "is staff" flag anywhere in the file.
    expect(sql).not.toMatch(/p_(is_staff|as_staff|viewer|role|for_handover)\b/);
  });
});

describe("the signature path is resolved, never accepted", () => {
  it("takes only a prescription id", async () => {
    const sql = await code(POLICY);
    const fn = sql.slice(sql.indexOf("function public.prescription_frozen_signature_path"));
    // The parameter list only — the function's own NAME contains "path".
    const params = fn.slice(fn.indexOf("(") + 1, fn.indexOf(")"));

    expect(params).toMatch(/p_prescription_id\s+uuid/);
    // A path parameter — even defaulted — is a path the caller chooses.
    expect(params).not.toMatch(/path|object|bucket|name/i);
  });

  it("returns the approved column for a finalised prescription", async () => {
    const sql = await code(POLICY);
    /**
     * Never a computed fallback when finalised. A fallback would hand out a URL
     * for an object nobody attested — which reads as a signature and is not one.
     */
    expect(sql).toMatch(/if v_rx\.status = 'FINALIZED' then\s*return v_rx\.signature_asset_path;/);
  });

  it("re-checks that the caller may read the prescription", async () => {
    const sql = await code(POLICY);
    const fn = sql.slice(sql.indexOf("function public.prescription_frozen_signature_path"));
    expect(fn).toMatch(/may_hand_over_prescription/);
    expect(fn).toMatch(/raise exception 'prescription not found'/);
  });
});

describe("the staff screen offers nothing staff cannot do", () => {
  it("sends non-owners somewhere they can actually go", async () => {
    const text = await read(COMPONENT);
    /**
     * Reception cannot open a consultation. Offering the link anyway is a dead
     * end that reads as a permissions error.
     */
    expect(text).toMatch(/viewerIsOwner \? `\/consultation\/\$\{encounterId\}` : "\/queue"/);
  });

  it("takes the viewer's identity from the server, not from a role guess", async () => {
    const text = await code(COMPONENT);
    // The prop is passed in; the component never derives it from a session.
    expect(text).toMatch(/viewerIsOwner: boolean/);
    expect(text).not.toMatch(/useSession|roles\.includes|RECEPTIONIST|LOCATION_ADMIN/);
  });

  it("keeps the clinical document itself identical for every reader", async () => {
    const text = await code(COMPONENT);

    /**
     * The point of the whole stage: doctor print === reception print. Both go
     * through ONE `ReviewSheet` and ONE `PrintPrescription`, from the same
     * bundle. A second, role-conditional render of either would be the bug.
     */
    expect(text.match(/<ReviewSheet\b/g)).toHaveLength(1);
    expect(text.match(/<PrintPrescription\b/g)).toHaveLength(1);
    expect(text).not.toMatch(/viewerIsOwner[^\n]*(ReviewSheet|PrintPrescription)/);
  });
});
