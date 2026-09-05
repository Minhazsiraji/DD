import { normalizePhone } from "./identity";

export interface FinderRankablePatient {
  id: string;
  patientNumber: string;
  fullName: string;
  phone: string | null;
}

export type FinderIdentifierKind = "PHONE" | "PATIENT_NUMBER" | "INVALID";

export function classifyFinderTerm(term: string): FinderIdentifierKind {
  const raw = term.trim();
  if (!raw) return "INVALID";

  const phoneLike = /^[+\d][\d\s().-]*$/.test(raw);
  const phone = phoneLike ? normalizePhone(raw) : null;
  if (phone && phone.length >= 4) return "PHONE";

  if (/^[A-Za-z]{1,8}[- ]?\d{2,}$/.test(raw)) return "PATIENT_NUMBER";
  return "INVALID";
}

export function finderRank(patient: FinderRankablePatient, term: string): number {
  const raw = term.trim();
  const kind = classifyFinderTerm(raw);
  if (kind === "INVALID") return Number.POSITIVE_INFINITY;

  if (kind === "PHONE") {
    const phone = normalizePhone(patient.phone);
    const searchPhone = normalizePhone(raw);
    if (!phone || !searchPhone) return Number.POSITIVE_INFINITY;
    if (phone === searchPhone) return 0;
    if (phone.startsWith(searchPhone)) return 1;
    if (phone.includes(searchPhone)) return 2;
    return Number.POSITIVE_INFINITY;
  }

  const patientNumber = patient.patientNumber.toLowerCase().replace(/\s+/g, "");
  const searchNumber = raw.toLowerCase().replace(/\s+/g, "");
  if (patientNumber === searchNumber) return 0;
  if (patientNumber.startsWith(searchNumber)) return 1;
  if (patientNumber.includes(searchNumber)) return 2;
  return Number.POSITIVE_INFINITY;
}

export function rankFinderPatients<T extends FinderRankablePatient>(
  patients: readonly T[],
  term: string,
  limit = 6,
): T[] {
  return [...patients]
    .map((patient) => ({ patient, rank: finderRank(patient, term) }))
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.patient.fullName.localeCompare(b.patient.fullName, "en", { sensitivity: "base" });
    })
    .slice(0, limit)
    .map(({ patient }) => patient);
}
