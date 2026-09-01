import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(file), "utf8");
}

function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("Deepgram Nova-3 pilot boundary", () => {
  it("uses Nova-3 with Bengali bn and model-improvement opt-out", async () => {
    const route = await source("src/app/api/voice/transcribe/route.ts");
    expect(route).toMatch(/DEEPGRAM_MODEL = "nova-3"/);
    expect(route).toMatch(/ALLOWED_LANGUAGES = new Set\(\["bn", "en-US"\]\)/);
    expect(route).toMatch(/mip_opt_out: "true"/);
    expect(route).toMatch(/smart_format: "true"/);
    expect(route).toMatch(/punctuate: "true"/);
  });

  it("keeps DEEPGRAM_API_KEY server-side only", async () => {
    const route = await source("src/app/api/voice/transcribe/route.ts");
    const provider = await source("src/features/dictation/provider.ts");
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(route).toMatch(/process\.env\.DEEPGRAM_API_KEY/);
    expect(route).not.toMatch(/NEXT_PUBLIC_DEEPGRAM/);
    expect(provider).not.toMatch(/DEEPGRAM_API_KEY|api\.deepgram\.com/);
    expect(button).not.toMatch(/DEEPGRAM_API_KEY|api\.deepgram\.com/);
  });

  it("authenticates a doctor before accepting audio", async () => {
    const route = codeOnly(await source("src/app/api/voice/transcribe/route.ts"));
    const authAt = route.indexOf('requirePermission("update", "encounter")');
    const formAt = route.indexOf("request.formData()");
    expect(authAt).toBeGreaterThanOrEqual(0);
    expect(formAt).toBeGreaterThan(authAt);
  });

  it("limits audio size, language choices and pilot request rate", async () => {
    const route = await source("src/app/api/voice/transcribe/route.ts");
    expect(route).toMatch(/MAX_AUDIO_BYTES = 5 \* 1024 \* 1024/);
    expect(route).toMatch(/MAX_REQUESTS_PER_WINDOW = 12/);
    expect(route).toMatch(/audio\.size > MAX_AUDIO_BYTES/);
    expect(route).toMatch(/ALLOWED_LANGUAGES\.has\(language\)/);
    expect(route).toMatch(/audio\.type\.startsWith\("audio\/"\)/);
  });

  it("returns only transcript and never logs provider payload/audio/transcript", async () => {
    const route = codeOnly(await source("src/app/api/voice/transcribe/route.ts"));
    expect(route).not.toMatch(/console\.(log|info|warn|error)/);
    expect(route).not.toMatch(/supabase|storage\.from|insert\(|update\(/);
    expect(route).toMatch(/return noStore\(\{ transcript \}\)/);
  });

  it("sends no patient, encounter, prescription or field identifier to Deepgram", async () => {
    const provider = codeOnly(await source("src/features/dictation/provider.ts"));
    const route = codeOnly(await source("src/app/api/voice/transcribe/route.ts"));
    for (const clinicalId of ["patientId", "encounterId", "prescriptionId", "fieldName"]) {
      expect(provider).not.toContain(clinicalId);
      expect(route).not.toContain(clinicalId);
    }
  });

  it("missing/invalid provider credentials fail as provider unavailable without exposing details", async () => {
    const route = await source("src/app/api/voice/transcribe/route.ts");
    expect(route).toMatch(/if \(!apiKey\) return noStore\(\{ code: "provider-unavailable" \}, 503\)/);
    expect(route).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(route).not.toMatch(/response\.text\(|response\.body/);
  });

  it("client capture is transient and cancellable", async () => {
    const provider = codeOnly(await source("src/features/dictation/provider.ts"));
    expect(provider).toMatch(/new Blob\(chunks/);
    expect(provider).toMatch(/controller\.abort\(\)/);
    expect(provider).toMatch(/getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
    for (const forbidden of ["localStorage", "indexedDB", "supabase", "upload(", "console.log"]) {
      expect(provider).not.toContain(forbidden);
    }
  });

  it("late/cancelled provider results cannot reach a new run", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    const provider = await source("src/features/dictation/provider.ts");
    expect(hook).toMatch(/activeRun\.current !== runId \|\| ended/);
    expect(hook).toMatch(/activeRun\.current \+= 1/);
    expect(provider).toMatch(/if \(cancelled\) return/);
  });

  it("the provider route contains no clinical write authority", async () => {
    const route = codeOnly(await source("src/app/api/voice/transcribe/route.ts"));
    for (const forbidden of [
      /finalize/i,
      /finishConsultation|finish_consultation/i,
      /addDiagnosis|addInvestigation|addPrescription/i,
      /expectedVersion|CAS/,
    ]) {
      expect(route).not.toMatch(forbidden);
    }
  });
});
