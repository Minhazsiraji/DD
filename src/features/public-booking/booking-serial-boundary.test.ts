import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const POLICY = path.resolve("supabase/policies/0031_public_booking_serial.sql");

describe("public booking serial boundary", () => {
  it("keeps queue token semantics separate from appointment serial", async () => {
    const sql = await readFile(POLICY, "utf8");
    expect(sql).not.toContain("token_number");
    expect(sql).not.toContain("queue_entries");
    expect(sql).not.toContain("queue_events");
  });

  it("requires PUBLIC doctor visibility and PUBLIC booking provenance", async () => {
    const sql = await readFile(POLICY, "utf8");
    expect(sql).toContain("d.profile_visibility = 'PUBLIC'");
    expect(sql).toContain("a.booking_source = 'PUBLIC'");
    expect(sql).toContain("a.public_booking_ref = p_booking_ref");
  });

  it("returns only the safe confirmation shape", async () => {
    const sql = await readFile(POLICY, "utf8");
    for (const key of [
      "'bookingRef'", "'serial'", "'doctorName'", "'chamberName'",
      "'date'", "'localTime'", "'status'",
    ]) expect(sql).toContain(key);

    for (const forbidden of ["patientId", "patientName", "phone", "reason"]) {
      expect(sql).not.toContain(`'${forbidden}'`);
    }
  });

  it("keeps cancelled rows in the rank so status changes cannot renumber", async () => {
    const sql = await readFile(POLICY, "utf8");
    expect(sql).toContain("x.created_at < v_created_at");
    expect(sql).toContain("x.id <= v_appointment_id");
    expect(sql).not.toMatch(/x\.status\s*(=|in|not\s+in)/i);
  });

  it("is SECURITY DEFINER with pinned search_path and closed grants", async () => {
    const sql = await readFile(POLICY, "utf8");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain(
      "revoke all on function public.public_booking_confirmation(text, uuid) from public;",
    );
    expect(sql).toContain(
      "grant execute on function public.public_booking_confirmation(text, uuid) to anon, authenticated;",
    );
  });
});
