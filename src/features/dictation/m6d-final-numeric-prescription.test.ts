import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseM6BCommand } from "./m6b-command-parser";
import { normalizeClinicalNumbers } from "./normalize";

describe("M6D deterministic clinical-number normalization", () => {
  it.each([
    ["BP one hundred eighteen by eighty", "BP 118/80"],
    ["BP hundred eighteen by eighty", "BP 118/80"],
    ["BP hundred 18 by 80", "BP 118/80"],
    ["blood pressure 120 by 80", "blood pressure 120/80"],
    ["BP 120 over 80", "BP 120/80"],
    ["pulse eighty", "pulse 80"],
    ["pulse eighty two per minute", "pulse 82 per minute"],
    ["temperature one hundred one", "temperature 101"],
    ["temperature one hundred one point five", "temperature 101.5"],
    ["SpO2 ninety eight percent", "SpO2 98%"],
    ["weight sixty kilograms", "weight 60 kilograms"],
  ])("normalizes only an explicit measurement cue: %s", (spoken, expected) => {
    expect(normalizeClinicalNumbers(spoken)).toBe(expected);
  });

  it.each([
    "fever for one hundred days",
    "patient took one tablet twice",
    "family history for twenty years",
    "one hundred eighteen by eighty",
  ])("leaves ordinary or unlabelled prose unchanged: %s", (spoken) => {
    expect(normalizeClinicalNumbers(spoken)).toBe(spoken);
  });

  it("preserves spoken units and never invents missing units", () => {
    expect(normalizeClinicalNumbers("pulse eighty bpm")).toBe("pulse 80 bpm");
    expect(normalizeClinicalNumbers("temperature one hundred one degrees Fahrenheit"))
      .toBe("temperature 101 degrees Fahrenheit");
    expect(normalizeClinicalNumbers("weight sixty")).toBe("weight 60");
  });
});

describe("M6D prescription navigation aliases", () => {
  const aliases = [
    "Prescription",
    "Open prescription",
    "Write prescription",
    "Go to prescription",
    "Start prescription",
    "Prescription kholo",
    "প্রেসক্রিপশন খোলো",
    "প্রেসক্রিপশন খুলে দাও",
    "প্রেসক্রিপশন লিখি",
  ];

  it.each(aliases)("maps %s to the existing prescription navigation intent", (spoken) => {
    expect(parseM6BCommand(spoken)).toMatchObject({ type: "NAVIGATE", target: "prescription" });
  });

  it.each(["history", "examination", "follow-up", "diagnosis", "investigation"])(
    "uses the same target-independent navigation intent from %s",
    () => {
      expect(parseM6BCommand("Prescription")).toMatchObject({ type: "NAVIGATE", target: "prescription" });
    },
  );

  it("does not treat ordinary prescription prose as a standalone command", () => {
    expect(parseM6BCommand("The previous prescription was reviewed")).toMatchObject({ type: "UNKNOWN" });
  });

  it("keeps Guided Voice dispatch ahead of Diagnosis and Investigation dictation", () => {
    const panel = readFileSync("src/features/encounters/components/m6a-voice-panel.tsx", "utf8");
    const clinicalDispatch = panel.indexOf("const parsedClinical = parseM6BCommand(text)");
    expect(clinicalDispatch).toBeGreaterThan(-1);
    expect(clinicalDispatch).toBeLessThan(panel.indexOf('if (destination.kind === "diagnosis")', clinicalDispatch));
    expect(clinicalDispatch).toBeLessThan(panel.indexOf('if (destination.kind === "investigation")', clinicalDispatch));
  });

  it("returns deterministic aliases to the existing M6B navigation receiver", () => {
    const route = readFileSync("src/app/api/voice/command/route.ts", "utf8");
    const commands = readFileSync("src/features/dictation/components/m6b-voice-commands.tsx", "utf8");
    const workspace = readFileSync("src/features/encounters/components/consultation-workspace.tsx", "utf8");
    expect(route).toContain('deterministic.target === "prescription"');
    expect(commands).toContain("void onNavigate(parsed.target)");
    expect(workspace).toContain('if (target === "prescription") return openRx(false)');
    expect(workspace).toContain("requestGuardedNavigation(() => router.push(path))");
  });
});
