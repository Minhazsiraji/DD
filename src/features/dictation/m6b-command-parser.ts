export type M6BNavigationTarget =
  | "prescription"
  | "investigations"
  | "previous-history"
  | "chief-complaint"
  | "history"
  | "examination"
  | "assessment"
  | "advice"
  | "follow-up"
  | "prescription-review";

export type M6BIntent =
  | { type: "NAVIGATE"; target: M6BNavigationTarget; rawText: string }
  | { type: "PROPOSE_MEDICINE"; rawText: string; medicine: { name: string; strengthText: string }; uncertainties: string[] }
  | { type: "PROPOSE_INVESTIGATION"; rawText: string; investigations: string[] }
  | { type: "PROPOSE_FOLLOW_UP"; rawText: string; days: number | null; uncertainties: string[] }
  | { type: "PROHIBITED_ACTION"; rawText: string; action: "FINALIZE_PRESCRIPTION" | "IRREVERSIBLE_DELETE" | "OWNERSHIP_CHANGE" | "FINALIZED_MUTATION" | "BYPASS_CONFIRMATION"; reviewOnly: boolean }
  | { type: "UNKNOWN"; rawText: string };

function clean(text: string) {
  return text.normalize("NFC").trim().replace(/[.।!?]+$/g, "").replace(/\s+/g, " ");
}

function normalizeBanglaDigits(text: string) {
  const bangla = "০১২৩৪৫৬৭৮৯";
  return text.replace(/[০-৯]/g, (digit) => String(bangla.indexOf(digit)));
}

function lower(text: string) {
  return normalizeBanglaDigits(clean(text)).toLocaleLowerCase("en-US");
}

function hasAny(value: string, phrases: readonly string[]) {
  return phrases.some((phrase) => value.includes(phrase));
}

const FINALIZE = ["finalize prescription", "finalise prescription", "prescription finalize", "prescription final", "প্রেসক্রিপশন ফাইনাল", "প্রেসক্রিপশন final", "final করো", "final koro"];
const DELETE = ["delete permanently", "irreversible delete", "স্থায়ীভাবে delete", "permanently মুছে"];
const OWNERSHIP = ["change doctor", "change patient owner", "change location owner", "ownership change", "ডাক্তার change", "patient owner change"];
const FINALIZED_MUTATION = ["change finalized prescription", "edit finalized prescription", "modify finalized prescription", "final prescription change", "ফাইনাল প্রেসক্রিপশন change", "ফাইনাল প্রেসক্রিপশন edit"];
const BYPASS = ["bypass confirmation", "skip confirmation", "confirmation বাদ", "confirm ছাড়াই"];

const NAVIGATION: readonly [M6BNavigationTarget, readonly string[]][] = [
  ["prescription", [
    "prescription",
    "open prescription",
    "write prescription",
    "go to prescription",
    "start prescription",
    "prescription kholo",
    "prescription খোলো",
    "প্রেসক্রিপশন খোলো",
    "প্রেসক্রিপশন খুলে দাও",
    "প্রেসক্রিপশন লিখি",
  ]],
  ["investigations", ["open investigations", "open investigation", "investigation kholo", "investigation খোলো", "টেস্ট খোলো", "পরীক্ষা খোলো"]],
  ["previous-history", ["open previous history", "previous history", "আগের history", "আগের হিস্ট্রি", "পুরোনো history"]],
  ["chief-complaint", ["go to chief complaint", "chief complaint e jao", "chief complaint এ যাও", "প্রধান অভিযোগে যাও"]],
  ["history", ["go to history", "history e jao", "history এ যাও", "হিস্ট্রিতে যাও", "ইতিহাসে যাও"]],
  ["examination", ["go to examination", "examination e jao", "examination এ যাও", "পরীক্ষা অংশে যাও"]],
  ["assessment", ["go to assessment", "assessment e jao", "assessment এ যাও", "অ্যাসেসমেন্টে যাও"]],
  ["advice", ["go to advice", "advice e jao", "advice এ যাও", "পরামর্শে যাও"]],
  ["follow-up", ["go to follow-up", "go to follow up", "go to next visit", "follow up e jao", "follow-up এ যাও", "ফলো আপে যাও", "পরবর্তী ভিজিটে যাও"]],
];

const INVESTIGATION_NAMES: readonly [string, readonly string[]][] = [
  ["CBC", ["cbc", "সি বি সি", "সিবিসি"]],
  ["Serum Creatinine", ["serum creatinine", "creatinine", "ক্রিয়েটিনিন", "ক্রিয়েটিনিন"]],
  ["HbA1c", ["hba1c", "hb a1c"]],
  ["TSH", ["tsh"]],
  ["ECG", ["ecg", "ইসিজি"]],
];

function extractInvestigations(value: string): string[] {
  return INVESTIGATION_NAMES.flatMap(([name, aliases]) => hasAny(value, aliases) ? [name] : []);
}

function parseDays(value: string): number | null {
  const dayDigit = value.match(/\b(\d{1,3})\s*(?:day|days|দিন)\b/i);
  if (dayDigit) return Number(dayDigit[1]);
  const weekDigit = value.match(/\b(\d{1,2})\s*(?:week|weeks|সপ্তাহ)\b/i);
  if (weekDigit) return Number(weekDigit[1]) * 7;
  const monthDigit = value.match(/\b(\d{1,2})\s*(?:month|months|মাস)\b/i);
  if (monthDigit) return Number(monthDigit[1]) * 30;
  const words: readonly [number, readonly string[]][] = [
    [1, ["one day", "এক দিন", "একদিন"]],
    [2, ["two days", "দুই দিন", "দুইদিন"]],
    [3, ["three days", "তিন দিন", "tin din"]],
    [5, ["five days", "পাঁচ দিন"]],
    [7, ["seven days", "সাত দিন", "sat din", "one week", "এক সপ্তাহ"]],
    [10, ["ten days", "দশ দিন"]],
    [14, ["fourteen days", "চৌদ্দ দিন", "two weeks", "দুই সপ্তাহ"]],
    [21, ["twenty one days", "twenty-one days", "three weeks", "তিন সপ্তাহ"]],
    [30, ["thirty days", "ত্রিশ দিন", "one month", "এক মাস"]],
    [60, ["sixty days", "two months", "দুই মাস"]],
    [90, ["ninety days", "three months", "তিন মাস"]],
  ];
  return words.find(([, aliases]) => hasAny(value, aliases))?.[0] ?? null;
}

function medicineProposal(raw: string, value: string): M6BIntent {
  const withoutCommand = raw
    .replace(/(?:add\s*(?:করো|koro)|যোগ\s*করো|দাও)/gi, " ")
    .replace(/\b(add|medicine|please|koro)\b/gi, " ")
    .replace(/করো/g, " ")
    .replace(/\s+/g, " ").trim();
  const strengthMatch = withoutCommand.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)\b/i);
  const bareNumber = withoutCommand.match(/\b(\d+(?:\.\d+)?)\b/);
  const strengthText = strengthMatch ? `${strengthMatch[1]} ${strengthMatch[2]}` : "";
  let name = withoutCommand;
  if (strengthMatch) name = name.replace(strengthMatch[0], "").trim();
  else if (bareNumber) name = name.replace(bareNumber[0], "").trim();
  name = name.replace(/[,.]+$/g, "").trim();
  const uncertainties: string[] = [];
  if (!strengthText && bareNumber) uncertainties.push("A number was heard but its unit is not explicit.");
  if (!strengthText && !bareNumber) uncertainties.push("Strength/dose is not explicit.");
  uncertainties.push("Frequency is not explicit.", "Duration is not explicit.");
  return { type: "PROPOSE_MEDICINE", rawText: raw, medicine: { name: name || clean(raw), strengthText }, uncertainties };
}

export function parseM6BCommand(text: string): M6BIntent {
  const raw = clean(text);
  const value = lower(raw);
  if (!raw) return { type: "UNKNOWN", rawText: raw };

  if (hasAny(value, FINALIZE)) return { type: "PROHIBITED_ACTION", rawText: raw, action: "FINALIZE_PRESCRIPTION", reviewOnly: true };
  if (hasAny(value, DELETE)) return { type: "PROHIBITED_ACTION", rawText: raw, action: "IRREVERSIBLE_DELETE", reviewOnly: false };
  if (hasAny(value, OWNERSHIP)) return { type: "PROHIBITED_ACTION", rawText: raw, action: "OWNERSHIP_CHANGE", reviewOnly: false };
  if (hasAny(value, FINALIZED_MUTATION)) return { type: "PROHIBITED_ACTION", rawText: raw, action: "FINALIZED_MUTATION", reviewOnly: false };
  if (hasAny(value, BYPASS)) return { type: "PROHIBITED_ACTION", rawText: raw, action: "BYPASS_CONFIRMATION", reviewOnly: false };

  const followUpCue = hasAny(value, [
    "follow-up", "follow up", "followup", "next visit", "next appointment", "review after",
    "ফলো আপ", "ফলোআপ", "পরবর্তী ভিজিট", "পরের ভিজিট", "পরবর্তী সাক্ষাৎ",
  ]);
  if (followUpCue && !hasAny(value, ["go to", "e jao", "এ যাও", "যাও", "খোলো"])) {
    const days = parseDays(value);
    return { type: "PROPOSE_FOLLOW_UP", rawText: raw, days, uncertainties: days ? [] : ["Follow-up interval is not explicit."] };
  }

  const investigations = extractInvestigations(value);
  if (investigations.length > 0 && hasAny(value, ["add", "যোগ", "করো", "koro"])) {
    return { type: "PROPOSE_INVESTIGATION", rawText: raw, investigations };
  }

  for (const [target, phrases] of NAVIGATION) {
    const matches = target === "prescription"
      ? phrases.some((phrase) => value === phrase)
      : hasAny(value, phrases);
    if (matches) return { type: "NAVIGATE", target, rawText: raw };
  }

  if (hasAny(value, ["add", "যোগ করো", "add করো", "add koro"])) return medicineProposal(raw, value);
  return { type: "UNKNOWN", rawText: raw };
}

export function authorizeM6BCommand(intent: M6BIntent, context: { editableEncounter: boolean }) {
  if (!context.editableEncounter) return { ok: false as const, message: "Voice commands require an active editable encounter." };
  if (intent.type === "UNKNOWN") return { ok: false as const, message: "Command not recognized. Nothing was changed." };
  return { ok: true as const };
}
