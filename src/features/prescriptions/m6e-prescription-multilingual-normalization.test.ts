import { describe, expect, it } from "vitest";
import {
  canonicalizeM6EFieldSpeech,
  canonicalizeM6EScheduleSpeech,
} from "./m6e-prescription-field-normalization";
import { parseM6EPrescriptionVoiceTargeting } from "./m6e-prescription-voice-targeting";

const fieldContext = (field: Parameters<typeof canonicalizeM6EFieldSpeech>[0]) => ({
  editorOpen: true,
  fieldTarget: field,
  destinationKind: "MEDICINE_FIELD" as const,
  autopilotProposalActive: false,
});

describe("M6E multilingual prescription field normalization", () => {
  it("normalizes the reported English schedule variants to printable notation", () => {
    expect(canonicalizeM6EScheduleSpeech("Twice daily")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("Daily to time")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("2 times daily")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("Daily 4 time")).toBe("1+1+1+1");
    expect(canonicalizeM6EScheduleSpeech("Morning and night")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("Morning, noon, and night")).toBe("1+1+1");
    expect(canonicalizeM6EScheduleSpeech("Morning, noon, night")).toBe("1+1+1");
  });

  it("normalizes Bangla and Banglish schedule language", () => {
    expect(canonicalizeM6EScheduleSpeech("এক যোগ শূন্য যোগ এক")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("সকাল ও রাত")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("সকাল, দুপুর, এবং রাত")).toBe("1+1+1");
    expect(canonicalizeM6EScheduleSpeech("দিনে দুইবার")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("দিনে তিনবার")).toBe("1+1+1");
    expect(canonicalizeM6EScheduleSpeech("দিনে চারবার")).toBe("1+1+1+1");
    expect(canonicalizeM6EScheduleSpeech("sokal rate")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("sokal dupur rat")).toBe("1+1+1");
    expect(canonicalizeM6EScheduleSpeech("proti 6 ghonta")).toBe("Every 6 hours");
  });

  it("normalizes strength, dose and form without guessing medicine identity", () => {
    expect(canonicalizeM6EFieldSpeech("strengthText", "পাঁচশ এমজি")).toBe("500 mg");
    expect(canonicalizeM6EFieldSpeech("strengthText", "five hundred mg")).toBe("500 mg");
    expect(canonicalizeM6EFieldSpeech("doseText", "এক ট্যাবলেট")).toBe("1 tablet");
    expect(canonicalizeM6EFieldSpeech("doseText", "আধা ট্যাবলেট")).toBe("Half tablet");
    expect(canonicalizeM6EFieldSpeech("doseText", "two capsules")).toBe("2 capsules");
    expect(canonicalizeM6EFieldSpeech("dosageForm", "ট্যাবলেট")).toBe("Tablet");
    expect(canonicalizeM6EFieldSpeech("displayName", "Issamiprazole")).toBe("Issamiprazole");
  });

  it("normalizes route, duration, quantity and food relation bilingually", () => {
    expect(canonicalizeM6EFieldSpeech("route", "মুখে")).toBe("Oral");
    expect(canonicalizeM6EFieldSpeech("route", "শিরায়")).toBe("IV");
    expect(canonicalizeM6EFieldSpeech("durationText", "তিন দিন")).toBe("3 days");
    expect(canonicalizeM6EFieldSpeech("durationText", "tin din")).toBe("3 days");
    expect(canonicalizeM6EFieldSpeech("quantityText", "দশ ট্যাবলেট")).toBe("10 tablets");
    expect(canonicalizeM6EFieldSpeech("foodRelation", "খাবারের পরে")).toBe("After food");
    expect(canonicalizeM6EFieldSpeech("foodRelation", "khali pete")).toBe("Empty stomach");
  });

  it("keeps doctor-authored name, brand, generic and instruction text unchanged", () => {
    expect(canonicalizeM6EFieldSpeech("displayName", "Napa Extend")).toBe("Napa Extend");
    expect(canonicalizeM6EFieldSpeech("brandName", "Napa")).toBe("Napa");
    expect(canonicalizeM6EFieldSpeech("genericName", "Paracetamol")).toBe("Paracetamol");
    expect(canonicalizeM6EFieldSpeech("instructions", "খাবারের পরে প্রচুর পানি খাবেন")).toBe("খাবারের পরে প্রচুর পানি খাবেন");
  });

  it("supports English, Bangla and Banglish field navigation/control commands", () => {
    expect(parseM6EPrescriptionVoiceTargeting("ডোজে যাও", fieldContext("scheduleText"))).toEqual({ type: "TARGET_FIELD", field: "doseText" });
    expect(parseM6EPrescriptionVoiceTargeting("schedule e jao", fieldContext("doseText"))).toEqual({ type: "TARGET_FIELD", field: "scheduleText" });
    expect(parseM6EPrescriptionVoiceTargeting("ডোজ পরিষ্কার করো", fieldContext("doseText"))).toEqual({ type: "CLEAR_FIELD", field: "doseText" });
    expect(parseM6EPrescriptionVoiceTargeting("ডোজ পড়ো", fieldContext("doseText"))).toEqual({ type: "READ_FIELD", field: "doseText" });
    expect(parseM6EPrescriptionVoiceTargeting("এই ফিল্ড পরিষ্কার করো", fieldContext("quantityText"))).toEqual({ type: "CLEAR_FIELD", field: "quantityText" });
  });

  it("supports direct bilingual field updates from any open medicine editor", () => {
    expect(parseM6EPrescriptionVoiceTargeting("ডোজ এক ট্যাবলেট", fieldContext("scheduleText"))).toEqual({ type: "SET_FIELD", field: "doseText", value: "1 tablet" });
    expect(parseM6EPrescriptionVoiceTargeting("রুট মুখে", fieldContext("scheduleText"))).toEqual({ type: "SET_FIELD", field: "route", value: "Oral" });
    expect(parseM6EPrescriptionVoiceTargeting("পরিমাণ দশ ট্যাবলেট", fieldContext("scheduleText"))).toEqual({ type: "SET_FIELD", field: "quantityText", value: "10 tablets" });
    expect(parseM6EPrescriptionVoiceTargeting("set brand Napa", fieldContext("scheduleText"))).toEqual({ type: "SET_FIELD", field: "brandName", value: "Napa" });
    expect(parseM6EPrescriptionVoiceTargeting("set instructions Take with water", fieldContext("scheduleText"))).toEqual({ type: "SET_FIELD", field: "instructions", value: "Take with water" });
  });

  it("canonicalizes ordinary dictation according to the authoritative active field", () => {
    expect(parseM6EPrescriptionVoiceTargeting("Morning, noon, and night", fieldContext("scheduleText"))).toEqual({ type: "SET_FIELD", field: "scheduleText", value: "1+1+1" });
    expect(parseM6EPrescriptionVoiceTargeting("দিনে দুইবার", fieldContext("scheduleText"))).toEqual({ type: "SET_FIELD", field: "scheduleText", value: "1+0+1" });
    expect(parseM6EPrescriptionVoiceTargeting("তিন দিন", fieldContext("durationText"))).toEqual({ type: "SET_FIELD", field: "durationText", value: "3 days" });
  });
});
