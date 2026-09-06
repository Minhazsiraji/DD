import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RX_MODULES, type RxModule, type RxModuleSetting } from "@/features/doctor/rx-modules";
import { MODULE_SOURCE, resolveVisibility } from "./module-visibility";
import { emptyDraft } from "./schema";
import {
  FOCUS_TARGET_KEYS,
  SHORTCUTS,
  directJumpTarget,
  filterTargets,
  focusTargetFor,
  isTypingTarget,
  jumpTargets,
  resolveShortcut,
  type ShortcutEvent,
} from "./fast-entry";

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
const allVisible = () => resolveVisibility(config({}), emptyDraft(), EMPTY_FINDINGS);

describe("M2 section navigation", () => {
  it("offers exactly the consultation sections on screen", () => {
    const hidden = resolveVisibility(
      config({ EXAMINATION: false, SYMPTOMS: false }),
      emptyDraft(),
      EMPTY_FINDINGS,
    );
    const modules = jumpTargets(hidden).map((target) => target.module);
    expect(modules).not.toContain("EXAMINATION");
    expect(modules).not.toContain("SYMPTOMS");

    const all = jumpTargets(allVisible()).map((target) => target.module);
    for (const module of RX_MODULES) {
      if (MODULE_SOURCE[module].kind === "patient-record") continue;
      expect(all).toContain(module);
    }
  });

  it("still exposes a disabled module when saved clinical content makes it visible", () => {
    const values = { ...emptyDraft(), examination: "Chest clear." };
    const visibility = resolveVisibility(config({ EXAMINATION: false }), values, EMPTY_FINDINGS);
    expect(jumpTargets(visibility).map((target) => target.module)).toContain("EXAMINATION");
  });

  it("keeps patient-record modules out of consultation focus", () => {
    expect(focusTargetFor("ALLERGY")).toBeNull();
    expect(focusTargetFor("LONG_TERM_MEDICINES")).toBeNull();
  });

  it("keeps the focus map complete", () => {
    expect([...FOCUS_TARGET_KEYS].sort()).toEqual([...RX_MODULES].sort());
  });

  it("filters without inventing a target", () => {
    const all = jumpTargets(allVisible());
    expect(filterTargets(all, "vit").map((target) => target.module)).toEqual(["VITALS"]);
    expect(filterTargets(all, "zzz")).toEqual([]);
  });

  it("maps Alt+1…7 to fixed M2 clinical sections", () => {
    const visibility = allVisible();
    expect(directJumpTarget("direct-1", visibility)?.module).toBe("CHIEF_COMPLAINT");
    expect(directJumpTarget("direct-2", visibility)?.module).toBe("VITALS");
    expect(directJumpTarget("direct-3", visibility)?.module).toBe("EXAMINATION");
    expect(directJumpTarget("direct-4", visibility)?.module).toBe("DIAGNOSIS");
    expect(directJumpTarget("direct-5", visibility)?.module).toBe("INVESTIGATIONS");
    expect(directJumpTarget("direct-6", visibility)?.module).toBe("ADVICE");
    expect(directJumpTarget("direct-7", visibility)?.module).toBe("NEXT_VISIT");
  });

  it("does not redirect a direct shortcut to a different section when its target is hidden", () => {
    const visibility = resolveVisibility(config({ EXAMINATION: false }), emptyDraft(), EMPTY_FINDINGS);
    expect(directJumpTarget("direct-3", visibility)).toBeNull();
  });
});

describe("M2 keyboard safety", () => {
  it("Ctrl/Cmd+K opens the section finder while free", () => {
    expect(resolveShortcut(press("k", { ctrlKey: true }), FREE)).toBe("open-jump");
    expect(resolveShortcut(press("k", { metaKey: true }), FREE)).toBe("open-jump");
  });

  it("Alt+G remains a compatible path to the section list", () => {
    expect(resolveShortcut(press("g", { altKey: true }), FREE)).toBe("open-jump-alt");
  });

  it("Alt+1…7 resolve only while the coordinator is free", () => {
    for (let key = 1; key <= 7; key += 1) {
      expect(resolveShortcut(press(String(key), { altKey: true }), FREE)).toBe(`direct-${key}`);
      expect(
        resolveShortcut(press(String(key), { altKey: true }), { blocked: true, open: false }),
      ).toBeNull();
    }
  });

  it("blocked also suppresses Ctrl/Cmd+K and Alt+G", () => {
    const blocked = { blocked: true, open: false };
    expect(resolveShortcut(press("k", { ctrlKey: true }), blocked)).toBeNull();
    expect(resolveShortcut(press("g", { altKey: true }), blocked)).toBeNull();
  });

  it("help and Escape remain available while blocked", () => {
    expect(resolveShortcut(press("h", { altKey: true }), { blocked: true, open: false })).toBe(
      "open-help",
    );
    expect(resolveShortcut(press("Escape"), { blocked: true, open: true })).toBe("dismiss");
  });

  it("never hijacks bare typing", () => {
    const target: ShortcutEvent["target"] = {
      tagName: "TEXTAREA",
      isContentEditable: false,
      role: null,
    };
    for (const key of ["g", "h", "k", "1", "7", "/", "Enter", " ", "a"]) {
      expect(resolveShortcut(press(key, { target }), FREE)).toBeNull();
    }
  });

  it("recognises typing surfaces", () => {
    expect(isTypingTarget({ tagName: "textarea", isContentEditable: false, role: null })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true, role: null })).toBe(true);
    expect(isTypingTarget({ tagName: "SPAN", isContentEditable: false, role: "combobox" })).toBe(true);
    expect(isTypingTarget({ tagName: "BODY", isContentEditable: false, role: null })).toBe(false);
  });

  it("never treats AltGr as an app shortcut", () => {
    expect(resolveShortcut(press("1", { altKey: true, ctrlKey: true }), FREE)).toBeNull();
    expect(resolveShortcut(press("g", { altKey: true, ctrlKey: true }), FREE)).toBeNull();
  });

  it("keeps the documented M2 shortcut vocabulary", () => {
    expect(SHORTCUTS.map((shortcut) => shortcut.chord)).toEqual([
      "Ctrl / Cmd + K",
      "Alt + 1",
      "Alt + 2",
      "Alt + 3",
      "Alt + 4",
      "Alt + 5",
      "Alt + 6",
      "Alt + 7",
      "Alt + G",
      "Alt + H",
    ]);
  });
});

describe("Fast Entry remains non-mutating", () => {
  it("imports no action/query/client and calls no clinical write", async () => {
    for (const file of [
      "src/features/encounters/fast-entry.ts",
      "src/features/encounters/components/fast-entry.tsx",
      "src/features/encounters/components/section-jump.tsx",
      "src/features/encounters/components/shortcut-help.tsx",
    ]) {
      const text = (await readFile(path.resolve(file), "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      const forbidden: [RegExp, string][] = [
        [/\bfrom\s+["'][^"']*actions["']/, "imports actions"],
        [/\bfrom\s+["'][^"']*queries["']/, "imports queries"],
        [/\bfrom\s+["'][^"']*supabase[^"']*["']/, "imports Supabase"],
        [/\w+Action\s*\(/, "calls a server action"],
        [/\bfetch\s*\(/, "calls fetch"],
        [/\buseConsultation\b/, "reaches into coordinator"],
        [/\bfinalize\w*\s*\(/, "finalises"],
        [/\bsave\w*\s*\(/, "saves"],
      ];
      for (const [pattern, what] of forbidden) {
        expect(pattern.test(text), `${file} ${what}`).toBe(false);
      }
    }
  });

  it("controller restores focus without animation-frame timing", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/components/fast-entry.tsx"),
      "utf8",
    );
    expect(src).toMatch(/prefers-reduced-motion/);
    expect(src).toMatch(/useLayoutEffect/);
    expect(src).not.toMatch(/requestAnimationFrame/);
    expect(src).toMatch(/event\.preventDefault\(\)/);
  });

  it("workspace passes its resolved visibility rather than computing another one", async () => {
    const src = await readFile(
      path.resolve("src/features/encounters/components/consultation-workspace.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<FastEntry visibility=\{visibility\} blocked=\{s\.blocked\}/);
    expect(src.match(/resolveVisibility\(/g)).toHaveLength(1);
  });
});
