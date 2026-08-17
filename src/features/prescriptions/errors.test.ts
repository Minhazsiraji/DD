import { describe, it, expect } from "vitest";
import {
  GENERIC_RX_ERROR,
  RX_UNCONFIRMED_MESSAGE,
  translateRxError,
} from "./errors";

/**
 * What a doctor is told when a prescription write is refused.
 *
 * The one property that must hold everywhere: a refusal may never imply the
 * typed medicine is gone. It is still in the form, and a message that suggests
 * otherwise makes a doctor retype a line they can see in front of them — or
 * worse, enter it twice.
 */

describe("translateRxError", () => {
  it("classifies a version conflict as a conflict, not an error", () => {
    const t = translateRxError("PRESCRIPTION_VERSION_CONFLICT");
    expect(t.kind).toBe("conflict");
    expect(t.unexpected).toBe(false);
  });

  it("says plainly that a conflicted change was NOT saved", () => {
    const t = translateRxError("PRESCRIPTION_VERSION_CONFLICT");
    expect(t.message).toMatch(/not saved/i);
    expect(t.message).toMatch(/still here/i);
    // Nothing was overwritten — the doctor must not go looking for lost work.
    expect(t.message).not.toMatch(/lost|discarded|deleted/i);
  });

  it("survives the wrapping PostgREST puts around a raised message", () => {
    const t = translateRxError(
      'unexpected response: PRESCRIPTION_VERSION_CONFLICT (code P0001)',
    );
    expect(t.kind).toBe("conflict");
  });

  it("explains that an approved prescription is corrected, not edited", () => {
    const t = translateRxError("PRESCRIPTION_NOT_DRAFT");
    expect(t.message).toMatch(/no longer be edited/i);
    expect(t.message).toMatch(/new prescription/i);
    expect(t.unexpected).toBe(false);
  });

  it("answers missing, not-yours and wrong-location identically", () => {
    // The database refuses all three with the same sentence on purpose. Telling
    // them apart here would hand back the existence the RPC withheld.
    const t = translateRxError("PRESCRIPTION NOT FOUND");
    expect(t.message).toBe("This prescription is no longer available at your current location.");
    expect(t.message).not.toMatch(/another doctor|belongs to|does not exist/i);
  });

  it("does not ask for a replacement reason no screen can collect yet", () => {
    const t = translateRxError("PRESCRIPTION_REPLACEMENT_NEEDS_REASON");
    expect(t.message).toMatch(/already been approved/i);
    // An instruction the doctor cannot follow is worse than a plain refusal.
    expect(t.message).not.toMatch(/say why|give a reason|enter a reason/i);
    expect(t.unexpected).toBe(false);
  });

  it("names the ordinary refusals a doctor can act on", () => {
    expect(translateRxError("A MEDICINE NEEDS A NAME").message).toMatch(/name/i);
    expect(translateRxError("MEDICINE NOT FOUND").message).toMatch(/no longer on this/i);
    expect(translateRxError("POSITION_OUT_OF_RANGE").message).toMatch(/position/i);
    expect(translateRxError("PATCH_EMPTY").message).toMatch(/nothing has changed/i);
  });

  it("keeps only-a-doctor-may-prescribe as its own sentence", () => {
    const t = translateRxError("ONLY A DOCTOR CAN WRITE A PRESCRIPTION");
    expect(t.message).toMatch(/only the treating doctor/i);
    expect(t.unexpected).toBe(false);
  });

  it("falls back to a safe sentence and flags it for the log", () => {
    const t = translateRxError('duplicate key value violates unique constraint "rx_pkey"');
    expect(t.kind).toBe("error");
    expect(t.message).toBe(GENERIC_RX_ERROR);
    expect(t.unexpected).toBe(true);
  });

  it("never leaks raw database text to the screen", () => {
    const raw = 'permission denied for table prescription_items (SQLSTATE 42501)';
    expect(translateRxError(raw).message).not.toContain("prescription_items");
    expect(translateRxError(raw).message).not.toMatch(/SQLSTATE|42501/);
  });

  it("never tells a doctor their typed medicine is gone", () => {
    const messages = [
      "PRESCRIPTION_VERSION_CONFLICT",
      "PRESCRIPTION_NOT_DRAFT",
      "MEDICINE NOT FOUND",
      "PATCH_EMPTY",
      "something nobody has ever seen",
    ].map((m) => translateRxError(m).message);

    for (const message of messages) {
      expect(message).not.toMatch(/your text was lost|start again|retype/i);
    }
  });
});

describe("the unconfirmed message", () => {
  it("tells the doctor not to enter the medicine a second time", () => {
    expect(RX_UNCONFIRMED_MESSAGE).toMatch(/may already have been saved/i);
    expect(RX_UNCONFIRMED_MESSAGE).toMatch(/do not enter it again/i);
  });

  it("does not claim the change failed", () => {
    expect(RX_UNCONFIRMED_MESSAGE).not.toMatch(/failed|was not saved/i);
  });

  it("is a different sentence from a refusal", () => {
    expect(RX_UNCONFIRMED_MESSAGE).not.toBe(
      translateRxError("PRESCRIPTION_VERSION_CONFLICT").message,
    );
  });
});
