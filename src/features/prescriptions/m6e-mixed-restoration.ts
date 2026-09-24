type Restoration = readonly [source: string, target: string];

const PHRASE_RESTORATIONS: readonly Restoration[] = [
  ["মেডিসিন সেকশনে যাও", "medicine section e jao"],
  ["মেডিসিন সেকশন খুলে দাও", "medicine section kholo"],
  ["মেডিসিনে যাও", "medicine e jao"],
  ["অটোপাইলটে যাও", "autopilot e jao"],
  ["ফলো আপ", "follow-up"],
  ["এম সি জি", "mcg"],
  ["এম জি", "mg"],
  ["এম এল", "mL"],
];

const TOKEN_RESTORATIONS: readonly Restoration[] = [
  ["পেশেন্টের", "Patient-এর"],
  ["পেশেন্ট", "Patient"],
  ["ফিভার", "fever"],
  ["সিবিসি", "CBC"],
  ["টেস্ট", "test"],
  ["প্রেসক্রিপশন", "prescription"],
  ["ফলোআপ", "follow-up"],
  ["মেডিসিন", "medicine"],
  ["সেকশন", "section"],
  ["অটোপাইলট", "Autopilot"],
  ["ডোজ", "dose"],
  ["স্ট্রেংথ", "strength"],
  ["ফ্রিকোয়েন্সি", "frequency"],
  ["ফ্রিকোয়েন্সি", "frequency"],
  ["সিডিউল", "schedule"],
  ["ডিউরেশন", "duration"],
  ["ট্যাবলেট", "tablet"],
  ["ক্যাপসুল", "capsule"],
  ["এমজি", "mg"],
  ["এমএল", "mL"],
  ["এমসিজি", "mcg"],
  ["পজ", "pause"],
  ["রিজিউম", "resume"],
  ["এন্ড", "end"],
  ["নেক্সট", "next"],
  ["প্রিভিয়াস", "previous"],
  ["প্রিভিয়াস", "previous"],
  ["অ্যাড", "add"],
  ["এডিট", "edit"],
  ["রিমুভ", "remove"],
  ["রিড", "read"],
  ["ক্লিয়ার", "clear"],
  ["ক্লিয়ার", "clear"],
  ["রিপ্লেস", "replace"],
  ["আনডু", "undo"],
  ["অ্যাপ্লাই", "apply"],
  ["ডিসকার্ড", "discard"],
  ["রিভিউ", "review"],
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceStandalone(text: string, source: string, target: string) {
  const pattern = new RegExp(`(?<!\\p{L})${escapeRegExp(source)}(?!\\p{L})`, "gu");
  return text.replace(pattern, target);
}

/**
 * Conservative script restoration for the Doctor's Diary mixed-language voice
 * contract. This is intentionally a closed vocabulary, not transliteration.
 * It must never infer medicine names, diagnoses, negation, numbers, or facts.
 */
export function restoreM6EMixedContractTerms(transcript: string): string {
  let restored = transcript.normalize("NFC");
  for (const [source, target] of PHRASE_RESTORATIONS) {
    restored = restored.split(source).join(target);
  }
  for (const [source, target] of TOKEN_RESTORATIONS) {
    restored = replaceStandalone(restored, source, target);
  }
  return restored;
}
