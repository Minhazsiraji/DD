import { normalizeName, normalizePhone } from "./identity";

export interface FinderRankablePatient {
  id: string;
  patientNumber: string;
  fullName: string;
  phone: string | null;
}

export type FinderIdentifierKind = "PHONE" | "PATIENT_NUMBER" | "NAME" | "INVALID";

export function classifyFinderTerm(term: string): FinderIdentifierKind {
  const raw = term.trim();
  if (!raw) return "INVALID";

  const phoneLike = /^[+\d][\d\s().-]*$/.test(raw);
  const phone = phoneLike ? normalizePhone(raw) : null;
  if (phone && phone.length >= 4) return "PHONE";

  if (/^[A-Za-z]{1,8}[- ]?\d{2,}$/.test(raw)) return "PATIENT_NUMBER";
  if (normalizeName(raw).length >= 2) return "NAME";
  return "INVALID";
}

function tokenOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

export function finderRank(patient: FinderRankablePatient, term: string): number {
  const raw = term.trim();
  const rawLower = raw.toLowerCase().replace(/\s+/g, "");
  const patientNumber = patient.patientNumber.toLowerCase().replace(/\s+/g, "");
  const phone = normalizePhone(patient.phone);
  const searchPhone = normalizePhone(raw);
  const name = normalizeName(patient.fullName);
  const searchName = normalizeName(raw);

  if (patientNumber === rawLower) return 0;
  if (searchPhone && phone === searchPhone) return 1;
  if (searchName && name === searchName) return 2;
  if (
    patientNumber.startsWith(rawLower) ||
    (searchPhone && phone?.startsWith(searchPhone)) ||
    (searchName && name.startsWith(searchName))
  ) return 3;
  if (searchName && tokenOverlap(name, searchName) >= 0.5) return 4;
  return 5;
}

export function rankFinderPatients<T extends FinderRankablePatient>(
  patients: readonly T[],
  term: string,
  limit = 6,
): T[] {
  return [...patients]
    .sort((a, b) => {
      const rank = finderRank(a, term) - finderRank(b, term);
      if (rank !== 0) return rank;
      return a.fullName.localeCompare(b.fullName, "en", { sensitivity: "base" });
    })
    .slice(0, limit);
}
