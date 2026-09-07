import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("M3 print actor boundary", () => {
  it("never accepts an actor identity from the browser for print initiation or confirmation", () => {
    const ui = read("src/features/prescriptions/components/print-prescription.tsx");
    expect(ui).toContain("initiatePrescriptionPrintAction({");
    expect(ui).toContain("prescriptionId,");
    expect(ui).toContain("idempotencyKey: initiationKey.current");
    expect(ui).toContain("confirmPrescriptionPrintAction({");
    expect(ui).toContain("operationId: pendingOperation.operationId");
    expect(ui).toContain("copyCount: count");
    expect(ui).not.toMatch(/actor(Id|ProfileId|Uuid)|auth\.uid|user\.id/);
  });

  it("derives print authority only on the server and does not expose raw actor UUIDs", () => {
    const actions = read("src/features/prescriptions/m3-actions.ts");
    expect(actions).toContain("await requireLocationContext()");
    expect(actions).toContain('supabase.rpc("initiate_prescription_print"');
    expect(actions).toContain('supabase.rpc("confirm_prescription_print"');
    expect(actions).toContain('supabase.rpc("prescription_print_history"');
    expect(actions).not.toMatch(/p_actor|actorProfileId|actorUuid/);
  });
});
