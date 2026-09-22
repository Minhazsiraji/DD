export type M6DTarget =
  | "chiefComplaints"
  | "presentIllness"
  | "examination"
  | "assessment"
  | "advice"
  | "nextVisitNote";

export const M6D_TARGETS: readonly M6DTarget[] = [
  "chiefComplaints", "presentIllness", "examination", "assessment", "advice", "nextVisitNote",
];

export type M6DNavigationIntent =
  | { type: "NAVIGATE"; target: M6DTarget }
  | { type: "NEXT" }
  | { type: "PREVIOUS" };

export type M6DStandaloneControlIntent =
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "END" }
  | { type: "UNDO" };

export type M6DDiagnosisIntent =
  | { type: "DIAGNOSIS_NAVIGATE" }
  | { type: "DIAGNOSIS_TARGET"; target: "title" | "certainty" | "note" }
  | { type: "DIAGNOSIS_CERTAINTY"; certainty: "PROVISIONAL" | "WORKING" | "CONFIRMED" | "RULED_OUT" }
  | { type: "DIAGNOSIS_REVIEW" };

export type M6DLocalIntent =
  | M6DNavigationIntent
  | M6DStandaloneControlIntent
  | M6DDiagnosisIntent
  | { type: "NOTE_EDIT"; operation: "ADD" | "REMOVE" | "REPLACE" | "CLEAR" | "READ"; value?: string; replacement?: string }
  | { type: "NONE" };

const SECTION_ALIASES: readonly [M6DTarget, readonly string[]][] = [
  ["chiefComplaints", ["chief complaint", "chief complaints", "cheap complaint", "cheap complaints", "প্রধান অভিযোগ"]],
  ["presentIllness", ["history", "history of present illness", "hpi", "হিস্ট্রি", "ইতিহাস"]],
  ["examination", ["examination", "exam", "পরীক্ষা"]],
  ["assessment", ["assessment", "impression", "অ্যাসেসমেন্ট"]],
  ["advice", ["advice", "পরামর্শ"]],
  ["nextVisitNote", ["follow up", "follow-up", "followup", "ফলো আপ"]],
];

function clean(text: string) {
  return text.normalize("NFC").trim().replace(/[.।!?]+$/g, "").replace(/\s+/g, " ");
}

export function isM6DCommandLikeUtterance(text: string): boolean {
  const raw = clean(text);
  if (!raw) return false;
  const value = raw.toLocaleLowerCase("en-US");
  if (/^(?:please\s+)?(?:add|prescribe|order|open|go\s+to|finali[sz]e|delete|change|edit|modify|bypass|skip)\b/i.test(value)) return true;
  if (/(?:^|\s)follow[- ]?up(?:\s|$)/i.test(value)) return true;
  return /(?:যোগ|দাও|করো|খোলো|যাও|মুছ|পরিবর্তন|প্রেসক্রিপশন)/u.test(raw);
}

export function nextM6DTarget(current: M6DTarget, direction: 1 | -1): M6DTarget {
  const index = Math.max(0, M6D_TARGETS.indexOf(current));
  return M6D_TARGETS[(index + direction + M6D_TARGETS.length) % M6D_TARGETS.length]!;
}

export function isM6DNavigationIntent(intent: M6DLocalIntent): intent is M6DNavigationIntent {
  return intent.type === "NAVIGATE" || intent.type === "NEXT" || intent.type === "PREVIOUS";
}

export function isM6DStandaloneControlIntent(intent: M6DLocalIntent): intent is M6DStandaloneControlIntent {
  return intent.type === "PAUSE" || intent.type === "RESUME" || intent.type === "END" || intent.type === "UNDO";
}

export function isM6DDiagnosisIntent(intent: M6DLocalIntent): intent is M6DDiagnosisIntent {
  return intent.type === "DIAGNOSIS_NAVIGATE" || intent.type === "DIAGNOSIS_TARGET" ||
    intent.type === "DIAGNOSIS_CERTAINTY" || intent.type === "DIAGNOSIS_REVIEW";
}

export function m6dNavigationCommandKey(intent: M6DNavigationIntent): string {
  return intent.type === "NAVIGATE" ? `NAVIGATE:${intent.target}` : intent.type;
}

export function resolveM6DNavigationTarget(intent: M6DNavigationIntent, current: M6DTarget): M6DTarget {
  if (intent.type === "NAVIGATE") return intent.target;
  return nextM6DTarget(current, intent.type === "NEXT" ? 1 : -1);
}

export function parseM6DLocalCommand(text: string): M6DLocalIntent {
  const raw = clean(text);
  const value = raw.toLocaleLowerCase("en-US");
  if (["next", "next section", "পরের সেকশন", "পরের অংশ"].includes(value)) return { type: "NEXT" };
  if (["previous", "previous section", "আগের সেকশন", "আগের অংশ"].includes(value)) return { type: "PREVIOUS" };
  if (value === "pause") return { type: "PAUSE" };
  if (value === "resume") return { type: "RESUME" };
  if (value === "end") return { type: "END" };
  if (["undo", "undo last sentence", "remove last sentence", "শেষ বাক্য undo", "শেষ বাক্য মুছো"].includes(value)) return { type: "UNDO" };
  if (value === "diagnosis" || value === "diagnoses") return { type: "DIAGNOSIS_NAVIGATE" };
  if (value === "diagnosis field") return { type: "DIAGNOSIS_TARGET", target: "title" };
  if (value === "how certain") return { type: "DIAGNOSIS_TARGET", target: "certainty" };
  if (value === "note" || value === "diagnosis note") return { type: "DIAGNOSIS_TARGET", target: "note" };
  if (value === "provisional") return { type: "DIAGNOSIS_CERTAINTY", certainty: "PROVISIONAL" };
  if (value === "working") return { type: "DIAGNOSIS_CERTAINTY", certainty: "WORKING" };
  if (value === "confirmed") return { type: "DIAGNOSIS_CERTAINTY", certainty: "CONFIRMED" };
  if (value === "ruled out") return { type: "DIAGNOSIS_CERTAINTY", certainty: "RULED_OUT" };
  if (["save diagnosis", "confirm diagnosis", "add diagnosis"].includes(value)) return { type: "DIAGNOSIS_REVIEW" };
  if (["clear current section", "clear section", "এই সেকশন clear", "এই অংশ মুছো"].includes(value)) return { type: "NOTE_EDIT", operation: "CLEAR" };
  if (["read current section", "read section", "এই সেকশন পড়ো", "এই অংশ পড়ো"].includes(value)) return { type: "NOTE_EDIT", operation: "READ" };
  const replace = raw.match(/^replace\s+(.+?)\s+with\s+(.+)$/i);
  if (replace) return { type: "NOTE_EDIT", operation: "REPLACE", value: replace[1]!.trim(), replacement: replace[2]!.trim() };
  const remove = raw.match(/^remove\s+(.+)$/i);
  if (remove) return { type: "NOTE_EDIT", operation: "REMOVE", value: remove[1]!.trim() };
  for (const [target, aliases] of SECTION_ALIASES) if (aliases.includes(value)) return { type: "NAVIGATE", target };
  return { type: "NONE" };
}
