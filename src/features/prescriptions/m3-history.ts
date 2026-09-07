import type { MedicineDraft } from "./schema";

export type SignedHistoryMode = "RECENT" | "FREQUENT";

/** Immutable wording returned by prescription_signed_medicine_history(). */
export interface SignedMedicineSuggestion extends MedicineDraft {
  lastUsed: string | null;
  timesUsed: number;
}

export interface PrescriptionReuseSource {
  prescriptionId: string;
  finalizedAt: string;
  locationId: string;
  locationName: string | null;
  itemCount: number;
  isSuperseded: boolean;
  isCorrection: boolean;
}

/** An opaque live row id paired with the immutable signed wording it selects. */
export interface PrescriptionReuseItem {
  itemId: string;
  position: number;
  displayName: string;
  brandName: string | null;
  genericName: string | null;
  strengthText: string | null;
  doseText: string | null;
  dosageForm: string | null;
  route: string | null;
  scheduleText: string | null;
  durationText: string | null;
  quantityText: string | null;
  foodRelation: string | null;
  isPrn: boolean;
  instructions: string | null;
  substitutionAllowed: boolean;
}

export interface PrescriptionReuseSourceDetail extends PrescriptionReuseSource {
  items: PrescriptionReuseItem[];
}

export function newReuseIdempotencyKey(): string {
  return `m3-reuse-${crypto.randomUUID()}`;
}
