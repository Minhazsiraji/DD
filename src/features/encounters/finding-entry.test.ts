import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { enterOutcome, isComposing, staysOpenAfterSuccess } from "./finding-entry";

/**
 * FAST ENTRY FOR FINDINGS.
 *
 * Two rules carry everything here. Enter adds and the form stays open, so a
 * doctor can type four diagnoses without touching the mouse — and the field
 * clears ONLY on a confirmed success, because until the record says it holds
 * the text, the doctor's field is the only copy of it that exists.
 */

function press(over: Partial<Parameters<typeof enterOutcome>[0]> = {}) {
  return { key: "Enter", isComposing: false, shiftKey: false, ...over };
}

const READY = { canSubmit: true };

describe("Enter adds", () => {
  it("submits when there is something to submit", () => {
    expect(enterOutcome(press(), READY)).toBe("submit");
  });

  it("does nothing on an empty field, and still swallows the key", () => {
    /**
     * Swallowed, not passed through: a form with one text input submits
     * IMPLICITLY on Enter, so letting it through would post an empty finding
     * around the guard.
     */
    expect(enterOutcome(press(), { canSubmit: false })).toBe("swallow");
  });

  it("leaves every other key alone", () => {
    for (const key of ["a", "Tab", "Escape", "ArrowDown", " "]) {
      expect(enterOutcome(press({ key }), READY), key).toBe("ignore");
    }
  });
});

describe("an input method's Enter is not ours", () => {
  /**
   * A doctor composing Bangla, Chinese, Japanese or Korean presses Enter to
   * CHOOSE A CANDIDATE. Submitting there posts a half-typed word as a
   * diagnosis, and nobody who is bitten once uses the shortcut again.
   */
  it("does not submit mid-composition", () => {
    expect(enterOutcome(press({ isComposing: true }), READY)).toBe("swallow");
  });

  it("…including input methods that only report the legacy keyCode", () => {
    expect(enterOutcome(press({ keyCode: 229 }), READY)).toBe("swallow");
  });

  it("recognises both composition signals", () => {
    expect(isComposing(press({ isComposing: true }))).toBe(true);
    expect(isComposing(press({ keyCode: 229 }))).toBe(true);
    expect(isComposing(press())).toBe(false);
  });

  it("and a normal Enter after composition ends still submits", () => {
    expect(enterOutcome(press({ isComposing: false, keyCode: 13 }), READY)).toBe("submit");
  });
});

describe("Shift+Enter never submits", () => {
  it("is swallowed rather than submitted", () => {
    // The title is single-line today. When it is not, this is already the rule
    // that makes Shift+Enter a newline instead of a save.
    expect(enterOutcome(press({ shiftKey: true }), READY)).toBe("swallow");
  });
});

describe("only an ADD keeps the form open", () => {
  it("adds keep going", () => {
    expect(staysOpenAfterSuccess("add")).toBe(true);
  });

  it("a correction is one deliberate act and closes", () => {
    // An empty form left behind would look like a second correction had begun.
    expect(staysOpenAfterSuccess("edit")).toBe(false);
  });

  it("and the coordinator ASKS, rather than assuming the caller only adds", async () => {
    /**
     * Caught by weakening: dropping this guard broke nothing, because the two
     * callers that pass `resetDraftOnSuccess` happen to be the add paths. That
     * makes the rule a convention rather than a control — a third caller, or a
     * correction reusing the option, would clear a correction form and leave it
     * open behind the doctor.
     */
    const src = await readFile(
      path.resolve("src/features/encounters/use-consultation.ts"),
      "utf8",
    );
    const runList = src.slice(
      src.indexOf("const runList = React.useCallback"),
      src.indexOf("const retrySync"),
    );
    expect(runList).toMatch(/staysOpenAfterSuccess\(\s*open\.mode\s*\)/);
  });
});

describe("the field clears only when the record confirms it", () => {
  it("the reset is reached ONLY on a clean confirmed success", async () => {
    /**
     * The five write outcomes are unchanged; exactly one of them clears text.
     * This reads the coordinator to prove the reset sits after the rows have
     * been read back and after the version has been checked — not beside the
     * refusal paths, where the doctor's text is their only copy.
     */
    const src = await readFile(
      path.resolve("src/features/encounters/use-consultation.ts"),
      "utf8",
    );
    const runList = src.slice(src.indexOf("const runList = React.useCallback"));
    const body = runList.slice(0, runList.indexOf("const retrySync"));

    const refreshed = body.indexOf("const refreshed = await refreshListsAction");
    const versionCheck = body.indexOf("if (versionMoved(");
    // From the version check onward — the first hit is the options TYPE in the
    // signature, which says nothing about where the reset actually runs.
    const reset = body.indexOf("options?.resetDraftOnSuccess", versionCheck);

    expect(refreshed).toBeGreaterThan(-1);
    expect(versionCheck).toBeGreaterThan(refreshed);
    expect(reset).toBeGreaterThan(versionCheck);

    // And it is inside the `result.ok` branch, never after a refusal.
    const okBranch = body.indexOf("if (result.ok)");
    const refusalBranch = body.indexOf('if (result.kind === "conflict")');
    expect(reset).toBeGreaterThan(okBranch);
    expect(reset).toBeLessThan(refusalBranch);
  });

  it("no refusal path clears the draft", async () => {
    /**
     * Conflict, write-unconfirmed, conflict-unloadable and a plain error each
     * leave the editor exactly as the doctor left it. Only `write-unconfirmed`
     * closes the form — deliberately, because the write MAY be on the record
     * and reopening an identical one is how a finding gets entered twice.
     */
    const src = await readFile(
      path.resolve("src/features/encounters/use-consultation.ts"),
      "utf8",
    );
    const runList = src.slice(src.indexOf("const runList = React.useCallback"));
    const refusals = runList.slice(
      runList.indexOf('if (result.kind === "conflict")'),
      runList.indexOf("const retrySync"),
    );
    expect(refusals).not.toMatch(/emptyFinding\(\)/);
    expect(refusals).not.toMatch(/resetDraftOnSuccess/);
    // The one deliberate close survives.
    expect(refusals).toMatch(/write-unconfirmed/);
  });

  it("the five outcomes are all still handled", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/use-consultation.ts"),
      "utf8",
    );
    const runList = src.slice(
      src.indexOf("const runList = React.useCallback"),
      src.indexOf("const retrySync"),
    );
    for (const outcome of [
      "result.ok",
      '"conflict"',
      '"write-unconfirmed"',
      '"conflict-unloadable"',
      "setListError",
    ]) {
      expect(runList.includes(outcome), `${outcome} is no longer handled`).toBe(true);
    }
  });
});

describe("the form itself writes nothing", () => {
  it("no clinical mutation happens before the trusted save path", async () => {
    /**
     * The form collects keystrokes and calls `onSubmit`. Every write still goes
     * through the coordinator, the one version and the one mutation queue.
     */
    const src = (
      await readFile(path.resolve("src/features/encounters/components/finding-form.tsx"), "utf8")
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    for (const [pattern, what] of [
      [/\bfrom\s+["'][^"']*actions["']/, "imports a server action module"],
      [/\w+Action\s*\(/, "calls a server action"],
      [/\bfetch\s*\(/, "calls fetch"],
      [/\bfrom\s+["'][^"']*supabase[^"']*["']/, "imports a Supabase client"],
    ] as [RegExp, string][]) {
      expect(pattern.test(src), `finding-form.tsx ${what}`).toBe(false);
    }
  });

  it("Enter is decided by the pure rule, not by implicit form submission", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/components/finding-form.tsx"),
      "utf8",
    );
    expect(src).toMatch(/enterOutcome\(/);
    // Every outcome preventDefaults, so the browser never submits behind it.
    expect(src).toMatch(/e\.preventDefault\(\)/);
    expect(src).toMatch(/isComposing: e\.nativeEvent\.isComposing/);
  });

  it("the NOTE stays a plain textarea, so Enter is still a newline", async () => {
    /**
     * The note is genuinely multi-line — "platelets falling, review tomorrow"
     * across two lines is normal. No key handler goes near it.
     */
    const src = await readFile(
      path.resolve("src/features/encounters/components/finding-form.tsx"),
      "utf8",
    );
    const note = src.slice(src.indexOf("<textarea"));
    expect(note).not.toMatch(/onKeyDown/);
  });

  it("focus comes back from a layout effect, never a scheduled callback", async () => {
    /**
     * Saving disables the input, and a disabled input is blurred — so the
     * cursor is gone after every add unless it is taken back. Step 1 settled
     * how: `requestAnimationFrame` does not fire in a tab that is not
     * compositing, and the failure is silent.
     */
    const src = (
      await readFile(path.resolve("src/features/encounters/components/finding-form.tsx"), "utf8")
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    expect(src).toMatch(/useLayoutEffect/);
    expect(src).not.toMatch(/requestAnimationFrame/);
    expect(src).not.toMatch(/setTimeout/);
    // Keyed on the token, so it fires once per confirmed add and never steals
    // focus while the doctor is elsewhere.
    expect(src).toMatch(/\[refocusToken\]/);
  });
});

describe("only adds opt into keeping the form open", () => {
  it("the workspace passes the reset for adds and not for corrections", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/components/consultation-workspace.tsx"),
      "utf8",
    );
    // Two adds — one diagnosis, one investigation.
    expect(src.match(/resetDraftOnSuccess: true/g)).toHaveLength(2);

    // Neither correction path opts in.
    const updates = [
      src.slice(src.indexOf("updateDiagnosisAction")),
      src.slice(src.indexOf("updateInvestigationAction")),
    ];
    for (const section of updates) {
      const call = section.slice(0, section.indexOf("return"));
      expect(call).not.toMatch(/resetDraftOnSuccess/);
    }
  });
});
