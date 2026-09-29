import { normalizeM6FCommandText } from "./m6f-action-grammar";

export type M6FInvestigationTarget =
  | "section" | "search" | "stagedList" | "stagedTitle" | "stagedNote"
  | "confirmedTitle" | "confirmedNote" | "confirm";

export type M6FInvestigationIntent =
  | { type: "TARGET"; target: M6FInvestigationTarget; index: number | null }
  | { type: "SET_SEARCH"; value: string }
  | { type: "READ"; target: M6FInvestigationTarget }
  | { type: "PROTECTED_CONFIRM" }
  | { type: "NONE" };

const INDEX: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  ek: 1, dui: 2, tin: 3, char: 4, pach: 5, choy: 6, sat: 7, at: 8, noy: 9, dosh: 10,
  "এক": 1, "দুই": 2, "তিন": 3, "চার": 4, "পাঁচ": 5, "ছয়": 6, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "নয়": 9, "দশ": 10,
};

function indexOf(raw: string | undefined): number | null {
  if (!raw) return null;
  if (/^\d{1,2}$/u.test(raw)) return Number(raw);
  return INDEX[raw.toLocaleLowerCase("en-US")] ?? null;
}

/** Commands here only focus or edit a local/staged surface. Confirmation stays visible and manual. */
export function parseM6FInvestigationCommand(rawTranscript: string): M6FInvestigationIntent {
  const raw = rawTranscript.normalize("NFC").trim().replace(/[.।!?]+$/gu, "").replace(/\s+/gu, " ");
  const { canonicalCommandText: value } = normalizeM6FCommandText(rawTranscript);
  if (/^(?:confirm investigations|investigation confirm koro|পরীক্ষা নিশ্চিত করো)$/iu.test(value)) return { type: "PROTECTED_CONFIRM" };

  const search = value.match(/^(?:search|find|খুঁজো|khojo)(?:\s+(?:investigation|test|পরীক্ষা))?\s+(.+)$/iu)
    ?? value.match(/^(?:investigation|test|পরীক্ষা)\s+(.+?)\s+(?:search koro|খুঁজো)$/iu);
  if (search?.[1]?.trim()) {
    const rawSearch = raw.match(/^(?:search|find|খুঁজো|khojo)(?:\s+(?:investigation|test|পরীক্ষা))?\s+(.+)$/iu)
      ?? raw.match(/^(?:investigation|test|পরীক্ষা)\s+(.+?)\s+(?:search koro|খুঁজো)$/iu);
    return { type: "SET_SEARCH", value: rawSearch?.[1]?.trim() ?? search[1].trim() };
  }

  if (/^(?:staged investigations|staged tests|স্টেজড ইনভেস্টিগেশন)$/iu.test(value) || /^স্টেজড ইনভেস্টিগেশন$/u.test(raw)) {
    return { type: "TARGET", target: "stagedList", index: null };
  }

  const indexed = value.match(/^(?:open|focus|target|go to|খোলো|যাও|kholo)?\s*(staged|confirmed|স্টেজড|নিশ্চিত)\s+(?:investigation|test|পরীক্ষা)(?:\s+(title|name|note|নাম|নোট))?(?:\s+(\d{1,2}|one|two|three|four|five|ek|dui|tin|char|pach|এক|দুই|তিন|চার|পাঁচ))?\s*(?:open|focus|খোলো|যাও|e jao)?$/iu);
  if (indexed) {
    const confirmed = /^(?:confirmed|নিশ্চিত)$/iu.test(indexed[1]!);
    const note = /^(?:note|নোট)$/iu.test(indexed[2] ?? "");
    return { type: "TARGET", target: confirmed ? (note ? "confirmedNote" : "confirmedTitle") : (note ? "stagedNote" : "stagedTitle"), index: indexOf(indexed[3]) };
  }

  if (/^(?:read|পড়ো|পড়ো|poro)\s+(?:staged investigations|staged tests|স্টেজড ইনভেস্টিগেশন)$/iu.test(value)) return { type: "READ", target: "stagedList" };
  if (/^(?:investigation|investigations|test order|ইনভেস্টিগেশন|টেস্ট অর্ডার)$/iu.test(value)) return { type: "TARGET", target: "section", index: null };
  if (/^(?:investigation search|test search|ইনভেস্টিগেশন সার্চ|টেস্ট সার্চ)$/iu.test(value)) return { type: "TARGET", target: "search", index: null };
  return { type: "NONE" };
}
