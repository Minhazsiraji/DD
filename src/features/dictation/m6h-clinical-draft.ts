import type { M6DTarget } from "./m6d-intent-router";
import type { M6GAmbientRoute, M6GAmbientTarget } from "./m6g-ambient-router";

export type M6HReviewLevel = "ready" | "confirmation" | "needs-review";
export type M6HDecision = "accepted" | "pending" | "rejected";

export interface M6HDraftItem {
  id: string;
  target: M6GAmbientTarget;
  text: string;
  level: M6HReviewLevel;
  decision: M6HDecision;
  reason: string;
  currentText?: string;
  proposedText?: string;
}

const PROTECTED = new Set<M6GAmbientTarget>(["diagnosis", "investigation", "medicine"]);
const FINALIZE = /\b(?:finali[sz]e|sign|complete\s+(?:encounter|consultation)|finish\s+consultation)\b/iu;

export function reviewLevel(route: M6GAmbientRoute): M6HReviewLevel {
  if (route.risk === "needs-review" || route.target === "needs-review" || FINALIZE.test(route.text)) return "needs-review";
  if (route.risk === "proposal" || PROTECTED.has(route.target)) return "confirmation";
  return "ready";
}

export function toDraftItem(route: M6GAmbientRoute, id: string): M6HDraftItem {
  const level = reviewLevel(route);
  return { id, target: route.target, text: route.text, level, decision: level === "ready" ? "accepted" : "pending", reason: route.reason };
}

export function acceptAllSafe(items: readonly M6HDraftItem[]): M6HDraftItem[] {
  return items.map((item) => item.level === "ready" ? { ...item, decision: "accepted" } : item);
}

export function approvedDocumentation(items: readonly M6HDraftItem[]): M6HDraftItem[] {
  return items.filter((item) => item.level === "ready" && item.decision === "accepted");
}

export function protectedPending(items: readonly M6HDraftItem[]): M6HDraftItem[] {
  return items.filter((item) => item.level === "confirmation" && item.decision !== "rejected");
}

export function reviewPending(items: readonly M6HDraftItem[]): M6HDraftItem[] {
  return items.filter((item) => item.level === "needs-review" && item.decision !== "rejected");
}

export function canApplyDocumentation(item: M6HDraftItem): item is M6HDraftItem & { target: M6DTarget } {
  return item.level === "ready" && item.decision === "accepted" && !PROTECTED.has(item.target) && item.target !== "needs-review";
}

function canonical(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function suppressDraftDuplicates(items: readonly M6HDraftItem[]): M6HDraftItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.target}:${canonical(item.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function withExistingDiff(item: M6HDraftItem, currentText: string): M6HDraftItem {
  if (!currentText.trim() || canonical(currentText) === canonical(item.text)) return item;
  return { ...item, currentText, proposedText: item.text };
}

export function clinicalSummary(items: readonly M6HDraftItem[]): string {
  return approvedDocumentation(items)
    .filter((item) => item.target !== "nextVisitNote")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(" ");
}
