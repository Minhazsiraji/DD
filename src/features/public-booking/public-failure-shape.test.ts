import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * AN ERROR MESSAGE IS A DISCLOSURE CHANNEL.
 *
 * `create_public_booking` distinguishes DUPLICATE_BOOKING from SLOT_TAKEN from
 * BOOKING_NOT_AVAILABLE, and it should — the doctor's logs need that. But the
 * caller here is anonymous, so surfacing the distinction hands a stranger an
 * oracle: "already booked" for a guessed phone number confirms that person has
 * an appointment with this doctor on this date. That is a clinical fact,
 * disclosed by a query string.
 *
 * The rule this file defends: every SERVER-side refusal collapses to one code.
 * Client-side validation may stay distinct, because it never reaches the
 * database and so reveals nothing about who exists.
 */
/**
 * Strip comments before asserting.
 *
 * These assertions are about what the CODE does. A comment explaining why the
 * database's refusal codes are not surfaced necessarily names them, and a test
 * that cannot tell prose from a branch would force the explanation out of the
 * file — losing the reason the rule exists to protect a regex.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the public booking endpoint answers identically however it fails", () => {
  let raw = "";
  let source = "";

  beforeAll(async () => {
    raw = await readFile(path.resolve("src/features/public-booking/actions.ts"), "utf8");
    source = code(raw);
  });

  it("keeps the reasoning in the file rather than deleting it to pass", () => {
    // If someone strips the explanation, the next person re-introduces the leak.
    expect(raw).toMatch(/oracle|disclosure/i);
  });

  it("emits exactly one error code for every server refusal", () => {
    const codes = [...source.matchAll(/\?error=([a-z-]+)/g)].map((m) => m[1]!);
    const unique = [...new Set(codes)];
    // "check-details" is the zod failure — it never round-trips to the server.
    expect(unique.sort()).toEqual(["check-details", "unavailable"]);
  });

  it("never branches on a database error message", () => {
    // Any read of error.message here is a leak waiting to be re-introduced.
    expect(source).not.toMatch(/error\?*\.message/);
    expect(source).not.toMatch(/includes\(\s*"(DUPLICATE_BOOKING|SLOT_TAKEN|SESSION_FULL)/);
  });

  it("names none of the database's refusal codes", () => {
    for (const code of [
      "DUPLICATE_BOOKING",
      "SLOT_TAKEN",
      "SESSION_FULL",
      "TOO_SOON",
      "DATE_NOT_AVAILABLE",
      "BOOKING_NOT_AVAILABLE",
      "TIME_NOT_AVAILABLE",
      "already-booked",
    ]) {
      expect(source, `actions.ts still references ${code}`).not.toContain(code);
    }
  });

  it("still refuses the duplicate at the database, where it belongs", async () => {
    // Removing the enumeration must not have removed the guard itself.
    const policy = await readFile(
      path.resolve("supabase/policies/0030_paid_doctor_commercial.sql"),
      "utf8",
    );
    expect(policy).toContain("DUPLICATE_BOOKING");
    expect(policy).toMatch(/p\.phone_normalized = v_phone_norm/);
  });

  it("does not leak the refusal through the page's own copy either", async () => {
    const page = await readFile(path.resolve("src/app/dr/[slug]/book/page.tsx"), "utf8");
    expect(page.toLowerCase()).not.toContain("already booked");
    expect(page.toLowerCase()).not.toContain("already have");
  });
});
