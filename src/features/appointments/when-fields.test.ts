import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { split } from "./components/when-fields";

/**
 * "Please come on 25 Aug at 7:30 PM."
 *
 * Date and time were one `datetime-local`, which on a desktop is a strip of
 * segments the arrow keys walk straight through — reception nudging the hour
 * could move the day without noticing, and the patient is told the wrong date.
 *
 * The controls are split; THE SUBMITTED VALUE IS NOT. Everything downstream of
 * the form — the timezone rules, the clinic's session-date derivation, the
 * stored timestamp — reads the same field in the same format as before.
 */

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("splitting an existing value", () => {
  it("takes the date and the time apart", () => {
    expect(split("2026-08-25T19:30")).toEqual({ date: "2026-08-25", time: "19:30" });
  });

  it("drops seconds a browser may add, keeping the minute", () => {
    expect(split("2026-08-25T19:30:00")).toEqual({ date: "2026-08-25", time: "19:30" });
  });

  it("never renders a control blank on a malformed value", () => {
    // A blank time control is one the doctor cannot see is unset.
    expect(split("").time).toBe("10:00");
    expect(split("garbage").time).toBe("10:00");
    expect(split("2026-08-25").time).toBe("10:00");
  });

  it("refuses to invent a date it was not given", () => {
    // Guessing a day is the one thing this control must never do.
    expect(split("").date).toBe("");
    expect(split("25-08-2026T10:00").date).toBe("");
  });
});

describe("the contract with the server is unchanged", () => {
  it("submits one `scheduledFor`, in the format the server already parses", async () => {
    const src = strip(
      await readFile(path.resolve("src/features/appointments/components/when-fields.tsx"), "utf8"),
    );
    expect(src).toMatch(/<input type="hidden" name="scheduledFor" value=\{`\$\{date\}T\$\{time\}`\}/);
  });

  it("changing one half cannot change the other", async () => {
    /**
     * Two pieces of state, each with its own control and its own setter. The
     * date input cannot reach `setTime` and the time input cannot reach
     * `setDate` — which is the whole point of the split.
     */
    const src = strip(
      await readFile(path.resolve("src/features/appointments/components/when-fields.tsx"), "utf8"),
    );
    const dateInput = src.slice(src.indexOf('id="book-date"'), src.indexOf('id="book-time"'));
    const timeInput = src.slice(src.indexOf('id="book-time"'));
    expect(dateInput).toMatch(/onChange=\{\(e\) => setDate\(e\.target\.value\)\}/);
    expect(dateInput).not.toMatch(/setTime/);
    expect(timeInput).toMatch(/onChange=\{\(e\) => setTime\(e\.target\.value\)\}/);
    expect(timeInput).not.toMatch(/setDate/);
  });

  it("the booking form no longer offers a combined control", async () => {
    const src = strip(
      await readFile(
        path.resolve("src/features/appointments/components/booking-panel.tsx"),
        "utf8",
      ),
    );
    expect(src).not.toMatch(/datetime-local/);
    expect(src).toMatch(/<WhenFields/);
  });

  it("nothing here derives a clinic day — that stays in the database", async () => {
    /**
     * `timestamptz::date` in the session's zone would file a late-evening Dhaka
     * appointment under the previous day. The location's timezone decides, in
     * SQL, and this component must never be tempted to help.
     */
    const src = strip(
      await readFile(path.resolve("src/features/appointments/components/when-fields.tsx"), "utf8"),
    );
    // `new Date(`, not `Date(` — `setDate(` is the state setter and matching
    // it would make this assertion about nothing.
    expect(src).not.toMatch(/toISOString|getTimezoneOffset|new Date\(|Intl\.|Date\.now/);
  });
});
