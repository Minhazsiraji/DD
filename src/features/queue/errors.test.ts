import { describe, it, expect } from "vitest";
import { translateQueueError, GENERIC_QUEUE_ERROR } from "./errors";

describe("translateQueueError", () => {
  it("explains a stale screen rather than reporting a fault", () => {
    const r = translateQueueError(
      'ERROR: that patient is already with the doctor CONTEXT: PL/pgSQL function public.queue_entry_for(uuid,uuid)',
    );
    expect(r.message).toContain("already in with the doctor");
    expect(r.unexpected).toBe(false);
  });

  it("uses one sentence for missing, forbidden and elsewhere alike", () => {
    // Distinguishing them would tell a caller which appointment ids exist.
    const r = translateQueueError("appointment not found");
    expect(r.message).toBe("That patient is no longer available to you.");
  });

  it("asks for the reason a priority change needs", () => {
    expect(translateQueueError("moving someone up the queue needs a reason").message).toContain(
      "Choose why",
    );
  });

  /**
   * The fallback used to be `Could not do that: ${message}`, which put Postgres
   * internals in front of doctors. These are realistic strings from this
   * project's own stack.
   */
  it.each([
    'duplicate key value violates unique constraint "queue_entries_appointment_key"',
    'permission denied for table queue_entries',
    'new row violates row-level security policy for table "queue_events"',
    'function public.call_patient(uuid, text) does not exist',
    'column "skipped_at" of relation "queue_entries" does not exist',
    'PGRST202: Could not find the function public.set_queue_priority',
    'null value in column "practice_location_id" violates not-null constraint',
    'deadlock detected (SQLSTATE 40P01)',
  ])("never leaks internals from: %s", (raw) => {
    const r = translateQueueError(raw);

    expect(r.message).toBe(GENERIC_QUEUE_ERROR);
    expect(r.unexpected, "the caller must know to log this").toBe(true);

    // Nothing recognisable from the original may survive into the message.
    const forbidden = [
      "queue_entries",
      "queue_events",
      "constraint",
      "row-level security",
      "permission denied",
      "public.",
      "SQLSTATE",
      "PGRST",
      "relation",
      "column",
      "null value",
      "deadlock",
    ];
    for (const token of forbidden) {
      expect(r.message.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });

  it("returns a stable message, not one derived from the input", () => {
    const a = translateQueueError("something exploded in schema public");
    const b = translateQueueError("an entirely different internal failure");
    expect(a.message).toBe(b.message);
    expect(a.message).toBe(GENERIC_QUEUE_ERROR);
  });

  it("tells the user what to do next", () => {
    expect(GENERIC_QUEUE_ERROR).toMatch(/refresh/i);
  });
});
