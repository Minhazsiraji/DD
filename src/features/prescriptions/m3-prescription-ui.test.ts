import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { draftFromRow, patchFromDraft, type MedicineRow } from "./schema";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const composer = () => read("src/features/prescriptions/components/prescription-composer.tsx");
const form = () => read("src/features/prescriptions/components/medicine-form.tsx");
const history = () => read("src/features/prescriptions/components/signed-medicine-history.tsx");
const reuse = () => read("src/features/prescriptions/components/prescription-reuse.tsx");
const hook = () => read("src/features/prescriptions/use-prescription.ts");
const m3Actions = () => read("src/features/prescriptions/m3-actions.ts");
const m3Queries = () => read("src/features/prescriptions/m3-queries.ts");
const print = () => read("src/features/prescriptions/components/print-prescription.tsx");

function fullRow(): MedicineRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    display_name: "Tab. Example",
    brand_name: "Brand",
    generic_name: "Generic",
    strength_text: "500 mg",
    dose_text: "1 tablet",
    dosage_form: "Tablet",
    route: "Oral",
    schedule_text: "1+0+1",
    duration_text: "7 days",
    quantity_text: "14 tablets",
    food_relation: "After food",
    is_prn: true,
    instructions: "Take with water",
    substitution_allowed: false,
    position: 1,
  };
}

describe("M3 fast medicine entry", () => {
  it("keeps the five speed fields first-visible and secondary fields behind progressive disclosure", () => {
    const source = form();
    for (const key of ["displayName", "strengthText", "doseText", "scheduleText", "durationText"]) {
      expect(source).toContain(`\"${key}\"`);
    }
    expect(source).toContain("FAST_FIELDS");
    expect(source).toContain("MORE_FIELDS");
    expect(source).toContain("More medicine details");
    expect(source).toContain("open={moreOpen}");
    expect(source).toContain("onToggle={(event) => setMoreOpen(event.currentTarget.open)}");
  });

  it("does not lose persisted secondary clinical fields when disclosure is closed/reopened", () => {
    const draft = draftFromRow(fullRow());
    const patch = patchFromDraft(draft);
    expect(patch.brandName).toBe("Brand");
    expect(patch.genericName).toBe("Generic");
    expect(patch.dosageForm).toBe("Tablet");
    expect(patch.route).toBe("Oral");
    expect(patch.quantityText).toBe("14 tablets");
    expect(patch.foodRelation).toBe("After food");
    expect(patch.instructions).toBe("Take with water");
    expect(patch.isPrn).toBe(true);
    expect(patch.substitutionAllowed).toBe(false);
  });

  it("retains explicit Add medicine and no keyboard finalize path", () => {
    const source = form();
    expect(source).toContain("if (canSubmit) onSubmit()");
    expect(source).toContain("Medicine name is the only required field");
    expect(source).not.toMatch(/finalize|approve prescription/i);
  });
});

describe("M3 signed history", () => {
  it("offers Recent, Frequent and lexical search from the authoritative endpoint", () => {
    const source = history();
    expect(source).toContain('"RECENT"');
    expect(source).toContain('"FREQUENT"');
    expect(source).toContain("Search signed medicines");
    expect(source).toContain("/api/m3-signed-medicine-history");
    expect(source).toContain("setTimeout");
  });

  it("has distinct loading, error and empty states", () => {
    const source = history();
    expect(source).toContain("loading");
    expect(source).toContain("setError");
    expect(source).toContain("No signed medicines found");
  });

  it("selection only proposes a form and cannot mutate directly", () => {
    const source = history();
    expect(source).toContain("onSelect(draft)");
    expect(source).toContain("Nothing is added until you press Add medicine");
    expect(source).not.toMatch(/addMedicineAction|add_prescription_item|reuse_finalized_prescription_items/);
  });

  it("server history reads only through prescription_signed_medicine_history and reports failures", () => {
    const source = m3Queries();
    expect(source).toContain('supabase.rpc("prescription_signed_medicine_history"');
    expect(source).toContain("SignedHistoryOutcome");
    expect(source).toContain('ok: false, message: "Signed medicine history is unavailable right now."');
  });
});

describe("M3 historical prescription reuse", () => {
  it("is wired into the real composer instead of a detached demo", () => {
    const source = composer();
    expect(source).toContain("<SignedMedicineHistory");
    expect(source).toContain("onSelect={rx.proposeMedicine}");
    expect(source).toContain("<PrescriptionReuse");
    expect(source).toContain("onReuse={rx.reuseHistory}");
  });

  it("keeps correction successors blank and disables whole-prescription reuse there", () => {
    const source = composer();
    expect(source).toContain("prescription.replacesPrescriptionId");
    expect(source).toContain("Correction draft starts blank");
    expect(source).toContain("Whole-prescription historical reuse is disabled here");
  });

  it("requires explicit source/item selection and append confirmation", () => {
    const source = reuse();
    expect(source).toContain("Reuse previous prescription");
    expect(source).toContain("selectedIds");
    expect(source).toContain("appendConfirmed");
    expect(source).toContain("append these medicines");
    expect(source).toContain('mode: "ALL"');
    expect(source).toContain('mode: "SELECTED"');
  });

  it("uses only the accepted atomic reuse RPC and never client-side item inserts", () => {
    const source = m3Actions();
    expect(source).toContain('supabase.rpc("reuse_finalized_prescription_items"');
    expect(source).toContain("p_expected_version");
    expect(source).toContain("p_idempotency_key");
    expect(source).toContain("p_append_confirmed");
    expect(source).not.toMatch(/\.from\(["']prescription_items["']\)\s*\.insert/);
  });

  it("maps expected reuse failures without exposing raw database text", () => {
    const source = m3Actions();
    for (const error of [
      "CORRECTION_SUCCESSOR_REUSE_FORBIDDEN",
      "APPEND_CONFIRMATION_REQUIRED",
      "SELECTED_ITEM_NOT_IN_SOURCE",
      "IDEMPOTENCY_KEY_CONFLICT",
      "PRESCRIPTION_FINALIZATION_STATE_INVALID",
    ]) {
      expect(source).toContain(error);
    }
  });
});

describe("M3 mutation coordinator regression", () => {
  it("keeps one MutationGate/version/recovery path for ordinary writes and reuse", () => {
    const source = hook();
    expect((source.match(/new MutationGate\(\)/g) ?? []).length).toBe(1);
    expect(source).toContain("liveVersion.current");
    expect(source).toContain("withWriteDeadline");
    expect(source).toContain("applyOutcome");
    expect(source).toContain("reconcileHeld");
    expect(source).toContain("gate.close()");
    expect(source).toContain("gate.open()");
    expect(source).toContain("reusePrescriptionItemsAction");
    expect(source).toContain("return run(");
  });

  it("retains ordinary add/edit/remove/move and canonical re-read recovery", () => {
    const source = hook();
    for (const action of [
      "addMedicineAction",
      "updateMedicineAction",
      "removeMedicineAction",
      "moveMedicineAction",
      "refreshPrescriptionAction",
    ]) {
      expect(source).toContain(action);
    }
    expect(source).toContain('state.kind === "conflict-unloadable"');
    expect(source).toContain('state.kind === "unknown"');
    expect(source).toContain('kind: "write-confirmed-advanced"');
  });
});

describe("M3 print audit around frozen native print", () => {
  it("records initiation before native print and confirmation only after explicit UI", () => {
    const source = print();
    const initiation = source.indexOf("const result = await initiatePrescriptionPrintAction");
    const native = source.indexOf("window.print();");
    const confirmation = source.indexOf("const result = await confirmPrescriptionPrintAction");
    expect(initiation).toBeGreaterThan(-1);
    expect(native).toBeGreaterThan(initiation);
    expect(confirmation).toBeGreaterThan(native);
    expect(source).toContain("Did physical copies actually print?");
    expect(source).toContain("Confirm printed copies");
    expect(source).toContain("No physical copy printed");
  });

  it("never treats native dialog closure or afterprint as proof", () => {
    const source = print();
    expect(source).toContain("Returning from the native dialog says nothing about physical paper");
    expect(source).not.toMatch(/afterprint|onafterprint/i);
    expect(source).not.toContain("confirmPrescriptionPrintAction({\n        operationId: result.operation.operationId");
  });

  it("validates copy count 1-100 and keeps unconfirmed attempts initiation-only", () => {
    const source = print();
    expect(source).toContain("count < 1 || count > 100");
    expect(source).toContain("min={1}");
    expect(source).toContain("max={100}");
    const leave = source.slice(source.indexOf("function leaveUnconfirmed"), source.indexOf("const latestInitiation"));
    expect(leave).not.toContain("confirmPrescriptionPrintAction");
    expect(leave).toContain("remains recorded as unconfirmed");
  });

  it("retains the UAT-proven direct-body portal and native window.print path", () => {
    const source = print();
    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body");
    expect(source).toContain("data-print-only");
    expect(source).toContain("window.print();");
    expect(source).not.toMatch(/iframe|toDataURL|canvas|screenshot/i);
  });

  it("uses server-derived print actors and exposes compact history without raw auth UUIDs", () => {
    const actions = m3Actions();
    const source = print();
    expect(actions).toContain('supabase.rpc("initiate_prescription_print"');
    expect(actions).toContain('supabase.rpc("confirm_prescription_print"');
    expect(actions).toContain('supabase.rpc("prescription_print_history"');
    expect(source).toContain("Print history");
    expect(source).toContain("actorName");
    expect(source).not.toMatch(/actor_profile_id|auth\.uid|user\.id/);
  });

  it("maps print authority, superseded and confirmation conflicts", () => {
    const source = m3Actions();
    for (const error of [
      "SUPERSEDED_PRESCRIPTION_HANDOVER_FORBIDDEN",
      "PRINT_AUTHORITY_REVOKED",
      "PRINT_CONFIRMATION_CONFLICT",
      "PRINT_FINALIZED_REFERENCE_INVALID",
      "IDEMPOTENCY_KEY_CONFLICT",
      "INVALID_PRINT_COPY_COUNT",
    ]) {
      expect(source).toContain(error);
    }
  });
});

describe("M3 review and finalization boundary", () => {
  it("still routes draft work to the separate review screen and has no finalize shortcut", () => {
    const source = composer();
    expect(source).toContain(`/prescription/${"${prescription.id}"}/review`);
    expect(source).toContain("Review prescription");
    expect(source).not.toMatch(/finalizePrescriptionAction|finalize_prescription|onKeyDown[^\n]*final/i);
  });

  it("does not render mutation accelerators on read-only finalized prescriptions", () => {
    const source = composer();
    expect(source).toContain("!readOnly ? (");
    expect(source).toContain("This prescription has been approved and can no longer be edited");
  });
});
