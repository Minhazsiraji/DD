import { describe, expect, it } from "vitest";
import { readFile, access } from "node:fs/promises";
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

describe("Deepgram Nova-3 streaming pilot boundary", () => {
  it("uses Nova-3 streaming with Bengali bn and model-improvement opt-out", async () => {
    const stream = await source("src/features/dictation/deepgram-stream.ts");
    expect(stream).toMatch(/DEEPGRAM_STREAM_MODEL = "nova-3"/);
    expect(stream).toMatch(/new Set\(\["bn", "en-US"\]\)/);
    expect(stream).toMatch(/interim_results: "true"/);
    expect(stream).toMatch(/mip_opt_out: "true"/);
    expect(stream).toMatch(/smart_format: "true"/);
    expect(stream).toMatch(/punctuate: "true"/);
  });

  it("removes the stop-then-upload batch endpoint", async () => {
    await expect(access(path.resolve("src/app/api/voice/transcribe/route.ts"))).rejects.toBeTruthy();
    const provider = codeOnly(await source("src/features/dictation/provider.ts"));
    expect(provider).not.toMatch(/new Blob\(|new FormData\(|\/api\/voice\/transcribe/);
  });

  it("keeps DEEPGRAM_API_KEY server-side only", async () => {
    const route = await source("src/app/api/voice/token/route.ts");
    const provider = await source("src/features/dictation/provider.ts");
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(route).toMatch(/process\.env\.DEEPGRAM_API_KEY/);
    expect(route).not.toMatch(/NEXT_PUBLIC_DEEPGRAM/);
    expect(provider).not.toMatch(/DEEPGRAM_API_KEY|NEXT_PUBLIC_DEEPGRAM/);
    expect(button).not.toMatch(/DEEPGRAM_API_KEY|NEXT_PUBLIC_DEEPGRAM/);
  });

  it("authenticates a doctor before minting any temporary credential", async () => {
    const route = await source("src/app/api/voice/token/route.ts");
    const authAt = route.indexOf('requirePermission("update", "encounter")');
    const keyAt = route.indexOf("process.env.DEEPGRAM_API_KEY");
    const grantAt = route.indexOf("https://api.deepgram.com/v1/auth/grant");
    expect(authAt).toBeGreaterThanOrEqual(0);
    expect(keyAt).toBeGreaterThan(authAt);
    expect(grantAt).toBeGreaterThan(keyAt);
  });

  it("limits token lifetime and pilot grant rate", async () => {
    const route = await source("src/app/api/voice/token/route.ts");
    expect(route).toMatch(/TOKEN_TTL_SECONDS = 30/);
    expect(route).toMatch(/MAX_GRANTS_PER_WINDOW = 12/);
    expect(route).toMatch(/ttl_seconds: TOKEN_TTL_SECONDS/);
    expect(route).toMatch(/Cache-Control.*private, no-store/s);
  });

  it("server token route never receives or logs audio/transcript/clinical context", async () => {
    const route = codeOnly(await source("src/app/api/voice/token/route.ts"));
    expect(route).not.toMatch(/formData\(|File|Blob|MediaRecorder|transcript/);
    expect(route).not.toMatch(/patientId|encounterId|prescriptionId|fieldName/);
    expect(route).not.toMatch(/console\.(log|info|warn|error)/);
    expect(route).not.toMatch(/supabase|storage\.from|insert\(|update\(/);
  });

  it("client audio is transient, chunked and cancellable", async () => {
    const provider = codeOnly(await source("src/features/dictation/provider.ts"));
    expect(provider).toMatch(/getUserMedia/);
    expect(provider).toMatch(/new MediaRecorder/);
    expect(provider).toMatch(/recorder\.start\(DEEPGRAM_MEDIA_TIMESLICE_MS\)/);
    expect(provider).toMatch(/socket\.send\(event\.data\)/);
    expect(provider).toMatch(/getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
    for (const forbidden of ["localStorage", "indexedDB", "supabase", "upload(", "console.log"]) {
      expect(provider).not.toContain(forbidden);
    }
  });

  it("late/cancelled provider events cannot reach a new run", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    const provider = await source("src/features/dictation/provider.ts");
    expect((hook.match(/activeRun\.current !== runId \|\| ended/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(hook).toMatch(/activeRun\.current \+= 1/);
    expect(provider).toMatch(/if \(cancelled \|\| terminal/);
  });

  it("the provider/token boundary contains no clinical write authority", async () => {
    for (const file of [
      "src/features/dictation/provider.ts",
      "src/features/dictation/deepgram-stream.ts",
      "src/app/api/voice/token/route.ts",
    ]) {
      const src = codeOnly(await source(file));
      for (const forbidden of [
        /finalizePrescription/i,
        /finishConsultation|finish_consultation/i,
        /addDiagnosis|addInvestigation|addMedicine/i,
        /expectedVersion|CAS/,
      ]) {
        expect(src).not.toMatch(forbidden);
      }
    }
  });
});
