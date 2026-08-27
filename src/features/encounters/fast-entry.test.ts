import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RX_MODULES, type RxModule, type RxModuleSetting } from "@/features/doctor/rx-modules";
import { MODULE_SOURCE, resolveVisibility } from "./module-visibility";
import { emptyDraft } from "./schema";
import {
  FOCUS_TARGET_KEYS,
  SHORTCUTS,
  filterTargets,
  focusTargetFor,
  isTypingTarget,
  jumpTargets,
  resolveShortcut,
  type ShortcutEvent,
} from "./fast-entry";

/**
 * FAST ENTRY MOVES THE CURSOR. IT NEVER MAKES A COMMITMENT.
 *
 * These tests hold two lines. The first is that the palette can only ever offer
 * a section the doctor is already looking at — it reads the same resolved
 * visibility the screen renders from, so consultation adoption governs it for
 * free. The second is that no accelerator survives a blocked coordinator, so a
 * shortcut can never push a write into a conflict nobody has answered.
 */

const EMPTY_FINDINGS = { diagnoses: 0, investigations: 0 };

function config(overrides: Partial<Record<RxModule, boolean>>): RxModuleSetting[] {
  return RX_MODULES.map((rxModule) => ({
    module: rxModule,
    useDuringConsultation: overrides[rxModule] ?? true,
    showOnPrint: false,
    printLabel: null,
  }));
}

function press(key: string, extra: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: { tagName: "BODY", isContentEditable: false, role: null },
    ...extra,
  };
}

const FREE = { blocked: false, open: false };

describe("the palette offers exactly what is on screen", () => {
  it("a hidden module is not a destination", () => {
    const hidden = resolveVisibility(
      config({ EXAMINATION: false, SYMPTOMS: false }),
      emptyDraft(),
      EMPTY_FINDINGS,
    );
    const modules = jumpTargets(hidden).map((t) => t.module);
    expect(modules).not.toContain("EXAMINATION");
    expect(modules).not.toContain("SYMPTOMS");
  });

  it("a visible module is", () => {
    const all = resolveVisibility(config({}), emptyDraft(), EMPTY_FINDINGS);
    const modules = jumpTargets(all).map((t) => t.module);
    for (const rxModule of RX_MODULES) {
      if (MODULE_SOURCE[rxModule].kind === "patient-record") continue;
      expect(modules, `${rxModule} is on screen and must be reachable`).toContain(rxModule);
    }
  });

  /**
   * The whole point of deriving from `resolveVisibility` rather than keeping a
   * list: a section that is turned off but already holds clinical text is still
   * on the screen, so it must still be reachable. A separate list would have
   * gone stale here and hidden the doctor's own examination from the shortcut
   * that exists to find it.
   */
  it("a module turned OFF but holding content is still reachable", () => {
    const withText = { ...emptyDraft(), examination: "Chest clear." };
    const v = resolveVisibility(config({ EXAMINATION: false }), withText, EMPTY_FINDINGS);
    expect(jumpTargets(v).map((t) => t.module)).toContain("EXAMINATION");
  });

  it("changing the doctor's configuration changes the destinations immediately", () => {
    const before = jumpTargets(resolveVisibility(config({}), emptyDraft(), EMPTY_FINDINGS));
    const after = jumpTargets(
      resolveVisibility(config({ ADVICE: false, VITALS: false }), emptyDraft(), EMPTY_FINDINGS),
    );
    expect(before.length - after.length).toBe(2);
    expect(after.map((t) => t.module)).not.toContain("ADVICE");
    expect(after.map((t) => t.module)).not.toContain("VITALS");
  });

  it("patient-record modules are never destinations, however they are configured", () => {
    // They have no consultation surface at all — there is nothing to focus.
    for (const use of [true, false]) {
      const v = resolveVisibility(
        config({ ALLERGY: use, LONG_TERM_MEDICINES: use }),
        emptyDraft(),
        EMPTY_FINDINGS,
      );
      const modules = jumpTargets(v).map((t) => t.module);
      expect(modules).not.toContain("ALLERGY");
      expect(modules).not.toContain("LONG_TERM_MEDICINES");
    }
    expect(focusTargetFor("ALLERGY")).toBeNull();
    expect(focusTargetFor("LONG_TERM_MEDICINES")).toBeNull();
  });

  it("a failed configuration read offers every section rather than none", () => {
    // Same direction as the workspace: never hide a clinical field over a
    // broken query.
    const v = resolveVisibility(null, emptyDraft(), EMPTY_FINDINGS);
    expect(jumpTargets(v).length).toBe(10);
  });

  it("every module has a decided focus target, so none can be added by accident", () => {
    expect([...FOCUS_TARGET_KEYS].sort()).toEqual([...RX_MODULES].sort());
  });

  it("filtering never invents a destination", () => {
    const all = jumpTargets(resolveVisibility(config({}), emptyDraft(), EMPTY_FINDINGS));
    expect(filterTargets(all, "vit").map((t) => t.module)).toEqual(["VITALS"]);
    expect(filterTargets(all, "zzz")).toEqual([]);
    expect(filterTargets(all, "")).toEqual(all);
  });
});

describe("blocked disables the accelerators", () => {
  it("the section palette will not open", () => {
    expect(resolveShortcut(press("g", { altKey: true }), { blocked: true, open: false })).toBeNull();
  });

  it("…and it does open when the coordinator is free", () => {
    // A control that is always inert would pass the test above for the wrong
    // reason.
    expect(resolveShortcut(press("g", { altKey: true }), FREE)).toBe("open-jump");
  });

  it("help still opens, because it explains why the rest went quiet", () => {
    expect(resolveShortcut(press("h", { altKey: true }), { blocked: true, open: false })).toBe(
      "open-help",
    );
  });

  it("Escape still closes what is open", () => {
    expect(resolveShortcut(press("Escape"), { blocked: true, open: true })).toBe("dismiss");
  });

  it("Escape does nothing when there is nothing open", () => {
    // It must never START an interaction, or it stops being an exit.
    expect(resolveShortcut(press("Escape"), FREE)).toBeNull();
  });
});

describe("typing is never hijacked", () => {
  /**
   * The rule that makes the rest safe: a bare key is never an action. A doctor
   * writing "give paracetamol" presses g, h and every other letter, and none of
   * them may mean anything.
   */
  it("no bare key resolves to an action — in a field or out of one", () => {
    const surfaces: ShortcutEvent["target"][] = [
      { tagName: "TEXTAREA", isContentEditable: false, role: null },
      { tagName: "INPUT", isContentEditable: false, role: null },
      { tagName: "SELECT", isContentEditable: false, role: null },
      { tagName: "DIV", isContentEditable: true, role: null },
      { tagName: "INPUT", isContentEditable: false, role: "combobox" },
      { tagName: "INPUT", isContentEditable: false, role: "searchbox" },
      { tagName: "BODY", isContentEditable: false, role: null },
    ];
    for (const target of surfaces) {
      for (const key of ["g", "h", "k", "/", "Enter", " ", "a"]) {
        expect(
          resolveShortcut(press(key, { target }), FREE),
          `bare "${key}" in <${target.tagName}> must mean nothing`,
        ).toBeNull();
      }
    }
  });

  it("every typing surface is recognised as one", () => {
    expect(isTypingTarget({ tagName: "textarea", isContentEditable: false, role: null })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true, role: null })).toBe(true);
    expect(isTypingTarget({ tagName: "SPAN", isContentEditable: false, role: "combobox" })).toBe(
      true,
    );
    expect(isTypingTarget({ tagName: "BODY", isContentEditable: false, role: null })).toBe(false);
  });

  /**
   * AltGr reports as Ctrl+Alt on Windows, and on a Bangla, German, Polish or
   * Nordic layout that is how ordinary characters are typed. Treating it as our
   * modifier would eat real keystrokes for a large share of the world.
   */
  it("AltGr is not our modifier", () => {
    expect(resolveShortcut(press("g", { altKey: true, ctrlKey: true }), FREE)).toBeNull();
    expect(resolveShortcut(press("h", { altKey: true, ctrlKey: true }), FREE)).toBeNull();
  });

  it("neither is Cmd or Ctrl alone — those belong to the browser", () => {
    expect(resolveShortcut(press("g", { metaKey: true }), FREE)).toBeNull();
    expect(resolveShortcut(press("g", { ctrlKey: true }), FREE)).toBeNull();
    expect(resolveShortcut(press("g", { altKey: true, metaKey: true }), FREE)).toBeNull();
  });

  it("the chord works inside a field, which is the only place it is ever pressed", () => {
    const inNote: ShortcutEvent["target"] = {
      tagName: "TEXTAREA",
      isContentEditable: false,
      role: null,
    };
    expect(resolveShortcut(press("g", { altKey: true, target: inNote }), FREE)).toBe("open-jump");
  });

  it("an unbound chord means nothing", () => {
    expect(resolveShortcut(press("q", { altKey: true }), FREE)).toBeNull();
  });

  it("the vocabulary stays small", () => {
    // Two chords plus Escape. A shortcut nobody remembers is a shortcut nobody
    // uses, and every extra key is one more chance to collide.
    expect(SHORTCUTS).toHaveLength(2);
  });
});

describe("nothing here can write", () => {
  it("no Fast Entry file imports an action, a query or a client", async () => {
    /**
     * The structural version of "accelerator, not a second data model". The
     * palette moves focus; the screen underneath owns every mutation, on the
     * one coordinator and the one version it always had.
     */
    for (const file of [
      "src/features/encounters/fast-entry.ts",
      "src/features/encounters/components/fast-entry.tsx",
      "src/features/encounters/components/section-jump.tsx",
      "src/features/encounters/components/shortcut-help.tsx",
    ]) {
      const text = (await readFile(path.resolve(file), "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

      /**
       * Matched as IMPORTS and CALLS, not as words. The help text says out loud
       * that shortcuts "never save, approve or finish anything", and a scanner
       * that read prose would have pushed that sentence out of the product
       * rather than the behaviour out of the code.
       */
      const forbidden: [RegExp, string][] = [
        [/\bfrom\s+["'][^"']*actions["']/, "imports a server action module"],
        [/\bfrom\s+["'][^"']*queries["']/, "imports a query module"],
        [/\bfrom\s+["'][^"']*supabase[^"']*["']/, "imports a Supabase client"],
        [/\w+Action\s*\(/, "calls a server action"],
        [/\bfetch\s*\(/, "calls fetch"],
        [/\buseConsultation\b/, "reaches into the coordinator"],
        [/\bfinalize\w*\s*\(/, "calls a finalisation"],
        [/\bsave\w*\s*\(/, "calls a save"],
      ];
      for (const [pattern, what] of forbidden) {
        expect(pattern.test(text), `${file} ${what}`).toBe(false);
      }
    }
  });

  it("the palette is a dialog with a combobox, and closes on Escape", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/components/section-jump.tsx"),
      "utf8",
    );
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/role="combobox"/);
    expect(src).toMatch(/role="listbox"/);
    expect(src).toMatch(/role="option"/);
    expect(src).toMatch(/aria-activedescendant/);
    expect(src).toMatch(/aria-label=/);
  });

  it("the controller returns focus and respects reduced motion", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/components/fast-entry.tsx"),
      "utf8",
    );
    expect(src).toMatch(/prefers-reduced-motion/);
    expect(src).toMatch(/returnTo/);
    // The chord must not also type a character on macOS.
    expect(src).toMatch(/event\.preventDefault\(\)/);
  });

  it("focus is restored in a LAYOUT EFFECT, never from requestAnimationFrame", async () => {
    /**
     * Found by smoke-testing this, not by reading it. `requestAnimationFrame`
     * does not fire in a tab that is not compositing — a background tab, a
     * throttled one, or the preview pane — and the failure is silent: the
     * dialog closes and the doctor's cursor is simply gone from the sentence
     * they were writing, with no error anywhere.
     */
    const src = (await readFile(
      path.resolve("src/features/encounters/components/fast-entry.tsx"),
      "utf8",
    ))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    expect(src).not.toMatch(/requestAnimationFrame/);
    expect(src).not.toMatch(/setTimeout/);
    expect(src).toMatch(/useLayoutEffect/);
  });

  it("the workspace passes its OWN visibility, never a second computation", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/components/consultation-workspace.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<FastEntry visibility=\{visibility\} blocked=\{s\.blocked\}/);
    // Exactly one place resolves visibility on this screen.
    expect(src.match(/resolveVisibility\(/g)).toHaveLength(1);
  });
});
