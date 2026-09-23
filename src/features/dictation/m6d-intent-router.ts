export type M6DTarget =
  | "chiefComplaints"
  | "presentIllness"
  | "pastHistory"
  | "examination"
  | "assessment"
  | "advice"
  | "nextVisitNote";

export const M6D_TARGETS: readonly M6DTarget[] = [
  "chiefComplaints", "presentIllness", "pastHistory", "examination", "assessment", "advice", "nextVisitNote",
];

export type M6DNavigationIntent =
  | { type: "NAVIGATE"; target: M6DTarget }
  | { type: "NEXT" }
  | { type: "PREVIOUS" };

export type M6DStandaloneControlIntent =
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "END" }
  | { type: "UNDO" }
  | { type: "REMOVE_LAST_SENTENCE" };

export type M6DDiagnosisIntent =
  | { type: "DIAGNOSIS_NAVIGATE" }
  | { type: "DIAGNOSIS_TARGET"; target: "title" | "certainty" | "note" }
  | { type: "DIAGNOSIS_CERTAINTY"; certainty: "PROVISIONAL" | "WORKING" | "CONFIRMED" | "RULED_OUT" }
  | { type: "DIAGNOSIS_REVIEW" };

export type M6DInvestigationIntent =
  | { type: "INVESTIGATION_NAVIGATE" }
  | { type: "INVESTIGATION_TARGET"; target: "field" };

export type M6DExtendedSection = "diagnoses" | "investigations";

export type M6DLocalIntent =
  | M6DNavigationIntent
  | M6DStandaloneControlIntent
  | M6DDiagnosisIntent
  | M6DInvestigationIntent
  | { type: "NOTE_EDIT"; operation: "ADD" | "REMOVE" | "REPLACE" | "REPLACE_LAST" | "CLEAR" | "READ"; value?: string; replacement?: string }
  | { type: "NONE" };

const SECTION_ALIASES: readonly [M6DTarget, readonly string[]][] = [
  ["chiefComplaints", ["chief complaint", "chief complaints", "complaint", "complaints", "cheap complaint", "cheap complaints", "প্রধান অভিযোগ", "মূল অভিযোগ", "অভিযোগ"]],
  ["presentIllness", ["history", "present illness", "history of present illness", "hpi", "হিস্ট্রি", "ইতিহাস", "বর্তমান অসুস্থতার ইতিহাস", "বর্তমান রোগের ইতিহাস"]],
  ["pastHistory", ["past history", "past medical history", "medical history", "previous illness history", "অতীত ইতিহাস", "পূর্ব ইতিহাস", "আগের রোগের ইতিহাস", "পূর্ববর্তী রোগের ইতিহাস"]],
  ["examination", ["examination", "exam", "physical examination", "clinical examination", "পরীক্ষা", "শারীরিক পরীক্ষা", "ক্লিনিক্যাল পরীক্ষা"]],
  ["assessment", ["assessment", "impression", "clinical impression", "অ্যাসেসমেন্ট", "মূল্যায়ন", "ধারণা"]],
  ["advice", ["advice", "plan", "পরামর্শ", "উপদেশ"]],
  ["nextVisitNote", ["follow up", "follow-up", "followup", "follow up note", "next visit", "next visit note", "ফলো আপ", "ফলোআপ", "পরবর্তী ভিজিট", "পরবর্তী সাক্ষাৎ"]],
];

function clean(text: string) {
  return text.normalize("NFC").trim().replace(/[.।!?]+$/g, "").replace(/\s+/g, " ");
}

export function isM6DCommandLikeUtterance(text: string): boolean {
  const raw = clean(text);
  if (!raw) return false;
  const value = raw.toLocaleLowerCase("en-US");
  if (/^(?:please\s+)?(?:add|prescribe|order|open|go\s+to|finali[sz]e|delete|change|edit|modify|replace|remove|clear|read|bypass|skip)\b/i.test(value)) return true;
  if (/(?:^|\s)follow[- ]?up(?:\s|$)/i.test(value)) return true;
  return /(?:যোগ|দাও|করো|খোলো|যাও|মুছ|পরিবর্তন|বদল|পড়ো|প্রেসক্রিপশন)/u.test(raw);
}

export function nextM6DTarget(current: M6DTarget, direction: 1 | -1): M6DTarget {
  const index = Math.max(0, M6D_TARGETS.indexOf(current));
  return M6D_TARGETS[(index + direction + M6D_TARGETS.length) % M6D_TARGETS.length]!;
}

export function isM6DNavigationIntent(intent: M6DLocalIntent): intent is M6DNavigationIntent {
  return intent.type === "NAVIGATE" || intent.type === "NEXT" || intent.type === "PREVIOUS";
}

export function isM6DStandaloneControlIntent(intent: M6DLocalIntent): intent is M6DStandaloneControlIntent {
  return intent.type === "PAUSE" || intent.type === "RESUME" || intent.type === "END" ||
    intent.type === "UNDO" || intent.type === "REMOVE_LAST_SENTENCE";
}

export function isM6DDiagnosisIntent(intent: M6DLocalIntent): intent is M6DDiagnosisIntent {
  return intent.type === "DIAGNOSIS_NAVIGATE" || intent.type === "DIAGNOSIS_TARGET" ||
    intent.type === "DIAGNOSIS_CERTAINTY" || intent.type === "DIAGNOSIS_REVIEW";
}

export function isM6DInvestigationIntent(intent: M6DLocalIntent): intent is M6DInvestigationIntent {
  return intent.type === "INVESTIGATION_NAVIGATE" || intent.type === "INVESTIGATION_TARGET";
}

export function resolveM6DExtendedSectionStep(
  current: M6DExtendedSection,
  direction: 1 | -1,
): M6DExtendedSection | null {
  if (current === "diagnoses" && direction === 1) return "investigations";
  if (current === "investigations" && direction === -1) return "diagnoses";
  return null;
}

export function removeM6DLastSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) return "";
  const withoutTrailingStop = trimmed.replace(/[.!?।]+$/u, "").trimEnd();
  const boundary = Math.max(
    withoutTrailingStop.lastIndexOf("."),
    withoutTrailingStop.lastIndexOf("!"),
    withoutTrailingStop.lastIndexOf("?"),
    withoutTrailingStop.lastIndexOf("।"),
  );
  return boundary < 0 ? "" : withoutTrailingStop.slice(0, boundary + 1).trimEnd();
}

export function m6dNavigationCommandKey(intent: M6DNavigationIntent): string {
  return intent.type === "NAVIGATE" ? `NAVIGATE:${intent.target}` : intent.type;
}

export function resolveM6DNavigationTarget(intent: M6DNavigationIntent, current: M6DTarget): M6DTarget {
  if (intent.type === "NAVIGATE") return intent.target;
  return nextM6DTarget(current, intent.type === "NEXT" ? 1 : -1);
}

function sectionFromAlias(value: string): M6DTarget | null {
  for (const [target, aliases] of SECTION_ALIASES) if (aliases.includes(value)) return target;
  return null;
}

function stripNavigationPrefix(value: string): string {
  return value
    .replace(/^(?:go to|open|show|move to|switch to)\s+/i, "")
    .replace(/^(?:যাও|খোলো|দেখাও|যান|খুলুন)\s+/u, "")
    .trim();
}

export function parseM6DAppendText(text: string): string | null {
  const raw = clean(text);
  const patterns = [
    /^(?:add text|add note|add to note|append|include)\s+(.+)$/i,
    /^(?:add)\s+(.+)$/i,
    /^(?:নোটে যোগ করো|নোটে যোগ করুন|যোগ করো|যোগ করুন|লিখো|লিখুন)\s+(.+)$/u,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function parseM6DLocalCommand(text: string): M6DLocalIntent {
  const raw = clean(text);
  const value = raw.toLocaleLowerCase("en-US");

  if (["next", "next section", "next field", "পরের সেকশন", "পরের অংশ", "পরের ঘর"].includes(value)) return { type: "NEXT" };
  if (["previous", "previous section", "previous field", "back", "আগের সেকশন", "আগের অংশ", "আগের ঘর", "পেছনে যাও"].includes(value)) return { type: "PREVIOUS" };

  if (["pause", "pause voice", "hold", "পজ", "বিরতি", "একটু থামো", "একটু থামুন"].includes(value)) return { type: "PAUSE" };
  if (["resume", "continue", "continue voice", "resume voice", "চালিয়ে যাও", "চালিয়ে যাও", "আবার শুরু", "আবার শুরু করো", "চালু করো"].includes(value)) return { type: "RESUME" };
  if (["end", "stop", "stop voice", "stop listening", "end voice", "শেষ", "শেষ করো", "বন্ধ করো", "ভয়েস বন্ধ করো", "ভয়েস বন্ধ করো"].includes(value)) return { type: "END" };
  if (["undo", "undo last", "undo last sentence", "go back last change", "বাতিল", "শেষটা ফেরত", "শেষ পরিবর্তন বাতিল", "শেষ বাক্য undo"].includes(value)) return { type: "UNDO" };
  if (["remove last sentence", "remove last line", "delete last sentence", "delete last line", "erase last sentence", "erase last line", "শেষ বাক্য মুছো", "শেষ লাইন মুছো", "শেষ কথাটা মুছো", "শেষ বাক্য বাদ দাও"].includes(value)) return { type: "REMOVE_LAST_SENTENCE" };

  if (["diagnosis", "diagnoses", "ডায়াগনোসিস", "ডায়াগনোসিস", "রোগ নির্ণয়", "রোগ নির্ণয়", "নির্ণয়", "নির্ণয়"].includes(value)) return { type: "DIAGNOSIS_NAVIGATE" };
  if (["diagnosis field", "diagnosis name", "diagnosis title", "ডায়াগনোসিস ফিল্ড", "ডায়াগনোসিস ফিল্ড", "রোগ নির্ণয়ের ঘর", "রোগ নির্ণয়ের ঘর"].includes(value)) return { type: "DIAGNOSIS_TARGET", target: "title" };
  if (["how certain", "certainty", "certainty level", "how sure", "কতটা নিশ্চিত", "নিশ্চিততা", "নিশ্চিততার মাত্রা"].includes(value)) return { type: "DIAGNOSIS_TARGET", target: "certainty" };
  if (["note", "note field", "note section", "diagnosis note", "diagnosis notes", "নোট", "নোট ফিল্ড", "নোট সেকশন", "ডায়াগনোসিস নোট", "ডায়াগনোসিস নোট"].includes(value)) return { type: "DIAGNOSIS_TARGET", target: "note" };
  if (["provisional", "সম্ভাব্য", "প্রভিশনাল"].includes(value)) return { type: "DIAGNOSIS_CERTAINTY", certainty: "PROVISIONAL" };
  if (["working", "working diagnosis", "ওয়ার্কিং", "ওয়ার্কিং", "কার্যকর ধারণা"].includes(value)) return { type: "DIAGNOSIS_CERTAINTY", certainty: "WORKING" };
  if (["confirmed", "confirm", "নিশ্চিত", "কনফার্মড"].includes(value)) return { type: "DIAGNOSIS_CERTAINTY", certainty: "CONFIRMED" };
  if (["ruled out", "rooted out", "excluded", "বাদ", "বাতিল", "রুলড আউট"].includes(value)) return { type: "DIAGNOSIS_CERTAINTY", certainty: "RULED_OUT" };
  if (["save diagnosis", "confirm diagnosis", "add diagnosis", "ডায়াগনোসিস সেভ", "রোগ নির্ণয় যোগ করো"].includes(value)) return { type: "DIAGNOSIS_REVIEW" };

  if (["investigation", "investigations", "investigation order", "investigation orders", "test", "tests", "test order", "test orders", "ইনভেস্টিগেশন", "ইনভেস্টিগেশন অর্ডার", "ইনভেস্টিগেশন অর্ডার্স", "পরীক্ষার অর্ডার", "টেস্ট", "টেস্ট অর্ডার"].includes(value)) return { type: "INVESTIGATION_NAVIGATE" };
  if (["investigation field", "investigation search", "test field", "test search", "ইনভেস্টিগেশন ফিল্ড", "ইনভেস্টিগেশন সার্চ", "টেস্ট ফিল্ড", "টেস্ট সার্চ"].includes(value)) return { type: "INVESTIGATION_TARGET", target: "field" };

  if (["clear current section", "clear this section", "clear section", "clear field", "clear this field", "clear note", "এই সেকশন clear", "এই সেকশন মুছো", "এই অংশ মুছো", "এই ঘর খালি করো", "নোট মুছো"].includes(value)) return { type: "NOTE_EDIT", operation: "CLEAR" };
  if (["read current section", "read this section", "read section", "read field", "read note", "এই সেকশন পড়ো", "এই অংশ পড়ো", "এই ঘর পড়ো", "নোট পড়ো"].includes(value)) return { type: "NOTE_EDIT", operation: "READ" };

  // Deepgram can occasionally flush the previous sentence and the next short
  // edit command in the same finalized utterance. Accept a trailing protected
  // edit only when it begins after a real sentence boundary; do not fuzzy-match
  // clinical prose in the middle of a sentence.
  let match = raw.match(/(?:^|[.!?।]\s+)(?:replace|change|correct)\s+(?:the\s+)?(?:last sentence|last line)\s+(?:with|to)\s+(.+)$/i);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE_LAST", replacement: match[1]!.trim() };
  match = raw.match(/(?:^|[.!?।]\s+)(?:শেষ বাক্য|শেষ লাইন)\s+(?:বদলে|পরিবর্তন করে)\s+(.+)$/u);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE_LAST", replacement: match[1]!.trim() };
  if (["replace last sentence", "replace last line", "replace the last sentence", "replace the last line", "change last sentence", "change last line", "change the last sentence", "change the last line", "correct last sentence", "correct last line", "correct the last sentence", "correct the last line", "শেষ বাক্য বদলাও", "শেষ লাইন বদলাও", "শেষ বাক্য পরিবর্তন করো", "শেষ লাইন পরিবর্তন করো"].includes(value)) {
    return { type: "NOTE_EDIT", operation: "REPLACE_LAST" };
  }

  match = raw.match(/^(?:replace|change|correct)\s+(.+?)\s+(?:with|to)\s+(.+)$/i);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE", value: match[1]!.trim(), replacement: match[2]!.trim() };
  match = raw.match(/^(.+?)\s+(?:এর বদলে|বদলে|পরিবর্তন করে)\s+(.+)$/u);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE", value: match[1]!.trim(), replacement: match[2]!.trim() };

  match = raw.match(/^(?:remove|delete|erase)\s+(.+)$/i);
  if (match) return { type: "NOTE_EDIT", operation: "REMOVE", value: match[1]!.trim() };
  match = raw.match(/^(.+?)\s+(?:বাদ দাও|মুছে দাও|মুছো|সরাও)$/u);
  if (match) return { type: "NOTE_EDIT", operation: "REMOVE", value: match[1]!.trim() };

  const stripped = stripNavigationPrefix(value);
  const target = sectionFromAlias(stripped);
  if (target) return { type: "NAVIGATE", target };
  return { type: "NONE" };
}
