import type { StagedInvestigation } from "./investigation-v1-contract";
import type { RecentInvestigation } from "./investigation-v1-queries";

export const COMMON_INVESTIGATIONS = [
  "CBC",
  "Urine R/M/E",
  "Serum Creatinine",
  "Blood Glucose",
  "HbA1c",
  "Lipid Profile",
  "TSH",
  "LFT",
  "Chest X-ray",
  "ECG",
  "Ultrasonography",
] as const;

export interface LocalStagedInvestigation extends StagedInvestigation {
  localId: string;
}

export interface PendingInvestigationConfirmation {
  operationKey: string;
  expectedVersion: number;
  investigations: StagedInvestigation[];
}

export interface InvestigationChoice {
  name: string;
  source: "common" | "recent";
  usageCount?: number;
  lastUsedAt?: string;
}

export interface StagingMutationResult {
  rows: LocalStagedInvestigation[];
  duplicate: boolean;
}

function compactSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeInvestigationName(value: string): string {
  return compactSpaces(value).toLocaleLowerCase();
}

function normalizeInvestigationNote(value: string | null | undefined): string {
  return compactSpaces(value ?? "").toLocaleLowerCase();
}

export function canonicalInvestigationNote(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function duplicateKey(row: Pick<StagedInvestigation, "name" | "note">): string {
  return `${normalizeInvestigationName(row.name)}\u0000${normalizeInvestigationNote(row.note)}`;
}

export function addStagedInvestigation(
  rows: LocalStagedInvestigation[],
  input: StagedInvestigation,
  localId: string,
): StagingMutationResult {
  const name = compactSpaces(input.name);
  if (!name) return { rows, duplicate: false };

  const candidate: LocalStagedInvestigation = {
    localId,
    name,
    note: canonicalInvestigationNote(input.note),
  };
  const key = duplicateKey(candidate);
  if (rows.some((row) => duplicateKey(row) === key)) {
    return { rows, duplicate: true };
  }
  return { rows: [...rows, candidate], duplicate: false };
}

export function updateStagedInvestigation(
  rows: LocalStagedInvestigation[],
  localId: string,
  patch: Partial<Pick<LocalStagedInvestigation, "name" | "note">>,
): StagingMutationResult {
  const current = rows.find((row) => row.localId === localId);
  if (!current) return { rows, duplicate: false };

  const candidate: LocalStagedInvestigation = {
    ...current,
    ...patch,
  };
  const key = duplicateKey(candidate);
  if (rows.some((row) => row.localId !== localId && duplicateKey(row) === key)) {
    return { rows, duplicate: true };
  }

  return {
    rows: rows.map((row) => (row.localId === localId ? candidate : row)),
    duplicate: false,
  };
}

export function removeStagedInvestigation(
  rows: LocalStagedInvestigation[],
  localId: string,
): LocalStagedInvestigation[] {
  return rows.filter((row) => row.localId !== localId);
}

export function stagingIsConfirmable(rows: LocalStagedInvestigation[]): boolean {
  return rows.length > 0 && rows.every((row) => compactSpaces(row.name).length > 0);
}

export function snapshotStagedInvestigations(
  rows: LocalStagedInvestigation[],
): StagedInvestigation[] {
  return rows.map((row) => ({
    name: compactSpaces(row.name),
    note: canonicalInvestigationNote(row.note),
  }));
}

export function confirmationButtonLabel(count: number): string {
  return `Confirm ${count} ${count === 1 ? "investigation" : "investigations"}`;
}

export function searchInvestigationChoices(
  recent: RecentInvestigation[],
  query: string,
  limit = 8,
): InvestigationChoice[] {
  const needle = normalizeInvestigationName(query);
  if (!needle) return [];

  const choices: InvestigationChoice[] = [];
  const seen = new Set<string>();

  for (const name of COMMON_INVESTIGATIONS) {
    const key = normalizeInvestigationName(name);
    if (!key.includes(needle) || seen.has(key)) continue;
    seen.add(key);
    choices.push({ name, source: "common" });
  }

  for (const row of recent) {
    const key = normalizeInvestigationName(row.name);
    if (!key.includes(needle) || seen.has(key)) continue;
    seen.add(key);
    choices.push({
      name: row.name,
      source: "recent",
      usageCount: row.usageCount,
      lastUsedAt: row.lastUsedAt,
    });
  }

  return choices.slice(0, Math.max(1, limit));
}

export function hasExactInvestigationChoice(
  choices: InvestigationChoice[],
  query: string,
): boolean {
  const needle = normalizeInvestigationName(query);
  return needle !== "" && choices.some((choice) => normalizeInvestigationName(choice.name) === needle);
}
