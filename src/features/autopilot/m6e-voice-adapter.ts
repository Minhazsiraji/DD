import type { AutopilotPrescription } from "./contracts";

export function proposalWithSelectedMedicines(
  proposal: AutopilotPrescription,
  selected: ReadonlySet<number>,
): AutopilotPrescription {
  return {
    ...proposal,
    medicines: proposal.medicines.filter((_, index) => selected.has(index)),
  };
}

export function selectionAfterMedicineRemoval(
  selected: ReadonlySet<number>,
  removedIndex: number,
): Set<number> {
  return new Set([...selected]
    .filter((index) => index !== removedIndex)
    .map((index) => index > removedIndex ? index - 1 : index));
}
