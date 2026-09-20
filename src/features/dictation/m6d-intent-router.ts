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

export type M6DLocalIntent =
  | { type: "NAVIGATE"; target: M6DTarget }
  | { type: "NEXT" }
  | { type: "PREVIOUS" }
  | { type: "UNDO" }
  | { type: "NOTE_EDIT"; operation: "ADD" | "REMOVE" | "REPLACE" | "CLEAR" | "READ"; value?: string; replacement?: string }
  | { type: "NONE" };

const SECTION_ALIASES: readonly [M6DTarget, readonly string[]][] = [
  ["chiefComplaints", ["chief complaint", "chief complaints", "প্রধান অভিযোগ"]],
  ["presentIllness", ["history", "history of present illness", "hpi", "হিস্ট্রি", "ইতিহাস"]],
  ["examination", ["examination", "exam", "পরীক্ষা"]],
  ["assessment", ["assessment", "impression", "অ্যাসেসমেন্ট"]],
  ["advice", ["advice", "পরামর্শ"]],
  ["nextVisitNote", ["follow up", "follow-up", "followup", "ফলো আপ"]],
];

function clean(text: string) {
  return text.normalize("NFC").trim().replace(/[।!?]+$/g, "").replace(/\s+/g, " ");
}

export function nextM6DTarget(current: M6DTarget, direction: 1 | -1): M6DTarget {
  const index = Math.max(0, M6D_TARGETS.indexOf(current));
  return M6D_TARGETS[(index + direction + M6D_TARGETS.length) % M6D_TARGETS.length]!;
}

export function parseM6DLocalCommand(text: string): M6DLocalIntent {
  const raw = clean(text);
  const value = raw.toLocaleLowerCase("en-US");
  if (["next", "next section", "পরের সেকশন", "পরের অংশ"].includes(value)) return { type: "NEXT" };
  if (["previous", "previous section", "আগের সেকশন", "আগের অংশ"].includes(value)) return { type: "PREVIOUS" };
  if (["undo", "undo last sentence", "remove last sentence", "শেষ বাক্য undo", "শেষ বাক্য মুছো"].includes(value)) return { type: "UNDO" };
  if (["clear current section", "clear section", "এই সেকশন clear", "এই অংশ মুছো"].includes(value)) return { type: "NOTE_EDIT", operation: "CLEAR" };
  if (["read current section", "read section", "এই সেকশন পড়ো", "এই অংশ পড়ো"].includes(value)) return { type: "NOTE_EDIT", operation: "READ" };
  const replace = raw.match(/^replace\s+(.+?)\s+with\s+(.+)$/i);
  if (replace) return { type: "NOTE_EDIT", operation: "REPLACE", value: replace[1]!.trim(), replacement: replace[2]!.trim() };
  const remove = raw.match(/^remove\s+(.+)$/i);
  if (remove) return { type: "NOTE_EDIT", operation: "REMOVE", value: remove[1]!.trim() };
  for (const [target, aliases] of SECTION_ALIASES) if (aliases.includes(value)) return { type: "NAVIGATE", target };
  return { type: "NONE" };
}
