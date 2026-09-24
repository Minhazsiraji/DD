import { describe, expect, it, vi } from "vitest";
import {
  createM6EHearingSequencer,
  isTrailingPreviewForStableUtterance,
} from "./components/m6e-prescription-voice-panel";

describe("M6E-A3 normalized Hearing authority", () => {
  it("keeps the normalized result visible when a late raw preview belongs to the same utterance", async () => {
    const raw = "পেশেন্টের ফিভার আছে, সিবিসি করতে হবে";
    const normalized = "Patient-এর fever আছে, CBC করতে হবে";
    const shown: string[] = [];
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ transcript: normalized }),
    }));
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    await hearing.onStable(raw, "bn-BD-mixed");
    expect(shown.at(-1)).toBe(normalized);

    hearing.onPreview(`${raw}।`);
    expect(shown.at(-1)).toBe(normalized);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("lets genuinely new speech replace the completed normalized Hearing result", async () => {
    const raw = "প্রেসক্রিপশন এ পেশেন্ট এখন স্টেবল";
    const normalized = "Prescription এ patient এখন stable";
    const shown: string[] = [];
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ transcript: normalized }),
    }));
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    await hearing.onStable(raw, "bn-BD-mixed");
    hearing.onPreview("নতুন বাক্য শুরু");

    expect(shown.at(-1)).toBe("নতুন বাক্য শুরু");
  });

  it("allows a repeated utterance to become a new stable authority", async () => {
    const raw = "পেশেন্টের ফিভার আছে";
    const shown: string[] = [];
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ transcript: "Patient-এর fever আছে" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ transcript: "Patient-এর fever আছে আবার" }) });
    const hearing = createM6EHearingSequencer({ display: (text) => shown.push(text), request });

    hearing.beginSession();
    await hearing.onStable(raw, "bn-BD-mixed");
    await hearing.onStable(raw, "bn-BD-mixed");

    expect(request).toHaveBeenCalledTimes(2);
    expect(shown.at(-1)).toBe("Patient-এর fever আছে আবার");
  });

  it("classifies punctuation and small provider corrections as the same completed utterance", () => {
    expect(isTrailingPreviewForStableUtterance("পেশেন্টের ফিভার আছে।", "পেশেন্টের ফিভার আছে")).toBe(true);
    expect(isTrailingPreviewForStableUtterance("পেশেন্টের ফিভার আছে", "পেশেন্টের ফিভার আছে, সিবিসি")).toBe(true);
    expect(isTrailingPreviewForStableUtterance("নতুন বাক্য", "পেশেন্টের ফিভার আছে")).toBe(false);
  });
});
