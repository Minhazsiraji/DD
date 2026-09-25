"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { M6C2AutopilotVoiceHandle } from "@/features/autopilot/components/m6c2-autopilot-panel";
import { emptyMedicine, type MedicineDraft } from "./schema";
import type { usePrescription } from "./use-prescription";
import {
  M6E_VOICE_FIELD_LABELS,
  M6E_VOICE_FIELD_ORDER,
  m6eVoiceTargetOptions,
  m6eVoiceTargetValue,
  parseM6EPrescriptionVoiceTargeting,
  type M6EVoiceDestination,
  type M6EVoiceTargetOption,
} from "./m6e-prescription-voice-targeting";
import type { M6EMedicineLookupScope, M6EVoiceMedicineField } from "./m6e-prescription-voice-contract";

const FIELD_SET = new Set<string>(M6E_VOICE_FIELD_ORDER);

export interface M6EVoiceMedicineMatch {
  key: string;
  label: string;
  source: "favorite" | "mine" | "catalogue";
  draft: MedicineDraft;
}

function medicineIndexForEditor(
  editor: ReturnType<typeof usePrescription>["editor"],
  items: ReturnType<typeof usePrescription>["items"],
): number | null {
  if (!editor || editor.mode !== "edit") return null;
  const index = items.findIndex((row) => row.id === editor.row.id);
  return index >= 0 ? index : null;
}

function destinationMedicineIndex(destination: M6EVoiceDestination): number | null {
  return destination.kind === "AUTOPILOT" ? null : destination.medicineIndex;
}

export function useM6EPrescriptionVoiceController({
  prescriptionId,
  readOnly,
  rx,
  autopilotVoiceRef,
}: {
  prescriptionId: string;
  readOnly: boolean;
  rx: ReturnType<typeof usePrescription>;
  autopilotVoiceRef: React.RefObject<M6C2AutopilotVoiceHandle | null>;
}) {
  const router = useRouter();
  const [destination, setDestination] = React.useState<M6EVoiceDestination>({
    kind: "MEDICINES",
    medicineIndex: null,
  });
  const destinationRef = React.useRef<M6EVoiceDestination>(destination);
  const voiceUndo = React.useRef<MedicineDraft | null>(null);
  const [medicineMatches, setMedicineMatches] = React.useState<M6EVoiceMedicineMatch[]>([]);
  const [medicineLookupPending, setMedicineLookupPending] = React.useState(false);
  const medicineLookupGeneration = React.useRef(0);

  function commitDestination(next: M6EVoiceDestination) {
    destinationRef.current = next;
    setDestination(next);
  }

  const currentTarget = m6eVoiceTargetValue(destination);
  const targetOptions: readonly M6EVoiceTargetOption[] = React.useMemo(
    () => m6eVoiceTargetOptions(rx.editor !== null),
    [rx.editor],
  );

  const contextLabel = React.useMemo(() => {
    if (destination.kind === "AUTOPILOT") return "Prescription · Autopilot";
    if (destination.kind === "MEDICINES") return "Prescription · Medicines";
    if (!rx.editor) return "Prescription · Medicines";
    const base = rx.editor.mode === "add"
      ? "Prescription · New medicine"
      : `Prescription · Medicine ${rx.editor.row.position}: ${rx.editor.row.display_name}`;
    return destination.kind === "MEDICINE_FIELD"
      ? `${base} · ${M6E_VOICE_FIELD_LABELS[destination.field]}`
      : base;
  }, [destination, rx.editor]);

  function scrollMedicines() {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-m6e-medicines]")?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  }

  function scrollMedicineForm() {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-medicine-form]")?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
  }

  function focusMedicineField(field: M6EVoiceMedicineField) {
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-medicine-field="${field}"]`);
      const details = element?.closest("details");
      if (details instanceof HTMLDetailsElement && !details.open) details.open = true;
      window.requestAnimationFrame(() => {
        const current = document.querySelector<HTMLElement>(`[data-medicine-field="${field}"]`);
        current?.scrollIntoView({ block: "center", behavior: "smooth" });
        current?.focus({ preventScroll: true });
      });
    });
  }

  function targetMedicines(message = "Voice target is Prescription · Medicines. No clinical field changed.") {
    const current = destinationRef.current;
    commitDestination({
      kind: "MEDICINES",
      medicineIndex: destinationMedicineIndex(current),
    });
    scrollMedicines();
    return message;
  }

  function targetAutopilot() {
    commitDestination({ kind: "AUTOPILOT" });
    return autopilotVoiceRef.current?.target() ?? "Autopilot is not available in this prescription context.";
  }

  function targetMedicineForm() {
    if (!rx.editor) return "Open Add medicine or Edit medicine first, then target the medicine form.";
    const medicineIndex = medicineIndexForEditor(rx.editor, rx.items);
    commitDestination({ kind: "MEDICINE_FORM", medicineIndex });
    scrollMedicineForm();
    return "Voice target is the staged Medicine form. No clinical field changed.";
  }

  function targetMedicineField(field: M6EVoiceMedicineField) {
    if (!rx.editor) return "Open Add medicine or Edit medicine first, then choose a medicine field.";
    const medicineIndex = medicineIndexForEditor(rx.editor, rx.items);
    commitDestination({ kind: "MEDICINE_FIELD", medicineIndex, field });
    focusMedicineField(field);
    return `Voice target set to ${M6E_VOICE_FIELD_LABELS[field]}. The next ordinary utterance edits only that staged field.`;
  }

  function selectTarget(value: string) {
    if (value === "MEDICINES") {
      targetMedicines();
      return;
    }
    if (value === "AUTOPILOT") {
      targetAutopilot();
      return;
    }
    if (value === "MEDICINE_FORM") {
      targetMedicineForm();
      return;
    }
    if (value.startsWith("FIELD:")) {
      const field = value.slice("FIELD:".length);
      if (FIELD_SET.has(field)) targetMedicineField(field as M6EVoiceMedicineField);
    }
  }

  React.useLayoutEffect(() => {
    const current = destinationRef.current;
    if (!rx.editor) {
      if (current.kind === "MEDICINE_FORM" || current.kind === "MEDICINE_FIELD") {
        commitDestination({ kind: "MEDICINES", medicineIndex: current.medicineIndex });
      }
      return;
    }

    const medicineIndex = medicineIndexForEditor(rx.editor, rx.items);
    if (current.kind === "MEDICINE_FIELD") {
      if (current.medicineIndex !== medicineIndex) {
        commitDestination({ ...current, medicineIndex });
      }
      return;
    }
    if (current.kind === "MEDICINE_FORM") {
      if (current.medicineIndex !== medicineIndex) {
        commitDestination({ kind: "MEDICINE_FORM", medicineIndex });
      }
      return;
    }
    commitDestination({ kind: "MEDICINE_FORM", medicineIndex });
  }, [rx.editor, rx.items]);

  React.useEffect(() => {
    function syncFocusedSurface(event: FocusEvent) {
      const element = event.target;
      if (!(element instanceof HTMLElement)) return;
      const field = element.dataset.medicineField;
      if (field && FIELD_SET.has(field) && rx.editor) {
        commitDestination({
          kind: "MEDICINE_FIELD",
          medicineIndex: medicineIndexForEditor(rx.editor, rx.items),
          field: field as M6EVoiceMedicineField,
        });
        return;
      }
      if (element.closest("[data-m6c2-autopilot]")) {
        commitDestination({ kind: "AUTOPILOT" });
        return;
      }
      if (element.closest("[data-medicine-form]") && rx.editor) {
        commitDestination({
          kind: "MEDICINE_FORM",
          medicineIndex: medicineIndexForEditor(rx.editor, rx.items),
        });
        return;
      }
      if (element.closest("[data-m6e-medicines]")) {
        const current = destinationRef.current;
        commitDestination({ kind: "MEDICINES", medicineIndex: destinationMedicineIndex(current) });
      }
    }
    document.addEventListener("focusin", syncFocusedSurface);
    return () => document.removeEventListener("focusin", syncFocusedSurface);
  }, [rx.editor, rx.items]);

  function openMedicine(index: number, label: "targeted" | "editing"): string {
    if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
    if (rx.editor && rx.dirty) return "Finish or cancel the current unsaved medicine before opening another one.";
    const row = rx.items[index - 1];
    if (!row) return `Medicine ${index} does not exist. Nothing changed.`;
    rx.openEdit(row);
    commitDestination({ kind: "MEDICINE_FORM", medicineIndex: index - 1 });
    voiceUndo.current = null;
    scrollMedicineForm();
    return `Medicine ${index} opened for staged ${label}. Saving still requires the existing explicit Save changes action.`;
  }

  function stageVoiceDraft(next: MedicineDraft) {
    voiceUndo.current = { ...rx.draft };
    rx.setDraft(next);
  }

  async function searchMedicineMatches(scope: M6EMedicineLookupScope, query: string): Promise<string> {
    const generation = ++medicineLookupGeneration.current;
    setMedicineLookupPending(true);
    try {
      const params = new URLSearchParams({ scope });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/m6e-medicine-lookup?${params.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("lookup-failed");
      const body = await response.json() as { matches?: M6EVoiceMedicineMatch[] };
      if (medicineLookupGeneration.current !== generation) return "A newer medicine search replaced this one.";
      const matches = Array.isArray(body.matches) ? body.matches.slice(0, 6) : [];
      setMedicineMatches(matches);
      if (matches.length === 0) return "No exact medicine match was found. Nothing changed.";
      const summary = matches.map((match, index) => `${index + 1}. ${match.label}`).join("; ");
      return `Found ${matches.length} medicine match${matches.length === 1 ? "" : "es"}: ${summary}. Say Use medicine 1, Use medicine 2, and so on.`;
    } catch {
      if (medicineLookupGeneration.current === generation) setMedicineMatches([]);
      return "Medicine lookup is unavailable right now. Nothing changed; you can still type the medicine manually.";
    } finally {
      if (medicineLookupGeneration.current === generation) setMedicineLookupPending(false);
    }
  }

  function stageMedicineMatch(index: number): string {
    const match = medicineMatches[index - 1];
    if (!match) return `Medicine search result ${index} is not available. Search medicines first.`;
    if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
    if (rx.editor?.mode === "edit") return "Finish or cancel the saved-medicine edit before loading a medicine search result.";
    if (rx.editor && rx.dirty) return "Finish or cancel the current unsaved medicine before loading a medicine search result.";
    if (!rx.editor) rx.openAdd();
    voiceUndo.current = rx.editor ? { ...rx.draft } : null;
    rx.setDraft({ ...match.draft });
    commitDestination({ kind: "MEDICINE_FORM", medicineIndex: null });
    scrollMedicineForm();
    setMedicineMatches([]);
    const source = match.source === "favorite" ? "Favorites" : match.source === "mine" ? "My Medicines" : "the shared catalogue";
    return `${match.label} loaded from ${source} into the staged medicine form. Review it and use the visible Add medicine button to save it.`;
  }

  function removeLastLineFromCurrentField(): string {
    const current = destinationRef.current;
    if (!rx.editor || current.kind !== "MEDICINE_FIELD" || rx.blocked) {
      return "Choose an editable medicine field before Remove last line. Nothing changed.";
    }
    const field = current.field;
    const value = rx.draft[field];
    if (!value.trim()) return `${M6E_VOICE_FIELD_LABELS[field]} is already empty.`;
    const lines = value.split(/\r?\n/u);
    while (lines.length > 0 && !lines.at(-1)?.trim()) lines.pop();
    lines.pop();
    stageVoiceDraft({ ...rx.draft, [field]: lines.join("\n") });
    focusMedicineField(field);
    return `${M6E_VOICE_FIELD_LABELS[field]} last line removed in the staged form only.`;
  }

  function moveField(direction: 1 | -1): string {
    if (!rx.editor) return "Open Add medicine or Edit medicine before using Next field or Previous field.";
    const current = destinationRef.current;
    const currentIndex = current.kind === "MEDICINE_FIELD"
      ? M6E_VOICE_FIELD_ORDER.indexOf(current.field)
      : direction > 0 ? -1 : M6E_VOICE_FIELD_ORDER.length;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= M6E_VOICE_FIELD_ORDER.length) {
      return direction > 0 ? "Already at the last medicine field." : "Already at the first medicine field.";
    }
    const field = M6E_VOICE_FIELD_ORDER[nextIndex]!;
    targetMedicineField(field);
    return `Voice target moved to ${M6E_VOICE_FIELD_LABELS[field]}.`;
  }

  function moveMedicine(direction: 1 | -1): string {
    if (rx.items.length === 0) return "There are no saved medicines to navigate.";
    if (rx.editor && rx.dirty) return "Finish or cancel the current unsaved medicine before moving to another medicine.";
    const currentDestination = destinationRef.current;
    const activeEditorIndex = medicineIndexForEditor(rx.editor, rx.items);
    const current = activeEditorIndex ?? destinationMedicineIndex(currentDestination) ?? (direction > 0 ? -1 : rx.items.length);
    const next = current + direction;
    if (next < 0 || next >= rx.items.length) {
      return direction > 0 ? "Already at the last medicine." : "Already at the first medicine.";
    }
    const row = rx.items[next]!;
    rx.openEdit(row);
    commitDestination({ kind: "MEDICINE_FORM", medicineIndex: next });
    voiceUndo.current = null;
    scrollMedicineForm();
    return `Medicine ${next + 1} opened for staged editing.`;
  }

  function moveSection() {
    return destinationRef.current.kind === "AUTOPILOT"
      ? targetMedicines("Voice target moved to Prescription · Medicines. No clinical field changed.")
      : targetAutopilot();
  }

  function openSignedMedicineHistory(mode: "RECENT" | "FREQUENT" | null): string {
    if (rx.blocked) return "Prescription editing is currently blocked. Signed medicine history was not opened.";
    if (rx.editor || rx.dirty) return "Finish or cancel the open medicine form before browsing signed medicine history.";

    const history = document.querySelector<HTMLDetailsElement>("[data-m3-signed-medicine-history]");
    if (!history) return "Signed medicine history is not available in this prescription context. Nothing changed.";

    history.open = true;
    if (mode) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`[data-m3-signed-history-mode="${mode}"]`)?.click();
      });
    }
    history.scrollIntoView({ block: "center", behavior: "smooth" });
    const label = mode === "FREQUENT" ? "Frequent" : "Recent";
    return `${label} signed medicine history opened. Choosing a line only fills the staged medicine form; Add medicine is still required.`;
  }

  function openPreviousPrescriptionReuse(): string {
    if (rx.editor || rx.dirty) return "Finish or cancel the open medicine form before reusing a previous prescription.";
    if (rx.confirmingRemoval) return "Resolve the pending medicine removal before reusing a previous prescription.";

    const openPanel = document.querySelector<HTMLElement>("[data-m3-prescription-reuse-panel]");
    if (openPanel) {
      openPanel.scrollIntoView({ block: "center", behavior: "smooth" });
      return "Previous prescription history is already open. Choose the signed prescription and medicines you want to reuse; nothing is copied automatically.";
    }

    const trigger = document.querySelector<HTMLButtonElement>("[data-m3-prescription-reuse-trigger]");
    if (!trigger || trigger.disabled) {
      return "Previous prescription reuse is not available in this prescription context. Nothing changed.";
    }

    trigger.click();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("[data-m3-prescription-reuse-panel]")?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
    return "Opening previous prescription history. Nothing will be copied until you explicitly choose and confirm the existing reuse action.";
  }

  async function handleStableTranscript(text: string): Promise<string> {
    const current = destinationRef.current;
    const fieldTarget = current.kind === "MEDICINE_FIELD" ? current.field : null;
    const intent = parseM6EPrescriptionVoiceTargeting(text, {
      editorOpen: rx.editor !== null,
      fieldTarget,
      destinationKind: current.kind,
      autopilotProposalActive:
        current.kind === "AUTOPILOT" && (autopilotVoiceRef.current?.hasProposal() ?? false),
    });

    if (readOnly) return "This prescription is approved and read-only. Nothing changed.";

    switch (intent.type) {
      case "NEXT_SECTION":
      case "PREVIOUS_SECTION":
        return moveSection();
      case "TARGET_MEDICINES":
        return targetMedicines();
      case "SEARCH_MEDICINE":
        return await searchMedicineMatches(intent.scope, intent.query);
      case "USE_MEDICINE_MATCH":
        return stageMedicineMatch(intent.index);
      case "REMOVE_LAST_LINE":
        return removeLastLineFromCurrentField();
      case "OPEN_ADD": {
        if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
        if (rx.editor) return "A medicine form is already open. Voice cannot save it; use the visible Add medicine/Save changes button or say Cancel medicine.";
        rx.openAdd();
        commitDestination({ kind: "MEDICINE_FIELD", medicineIndex: null, field: "displayName" });
        voiceUndo.current = null;
        focusMedicineField("displayName");
        return "New medicine form opened. Voice target is Medicine name. Dictation stays staged until you explicitly add it.";
      }
      case "TARGET_MEDICINE":
        return openMedicine(intent.index, "targeted");
      case "EDIT_MEDICINE":
        return openMedicine(intent.index, "editing");
      case "READ_MEDICINE": {
        if (!rx.editor) return "Open or target a medicine before Read medicine.";
        const facts = [
          rx.draft.displayName,
          rx.draft.strengthText,
          rx.draft.doseText,
          rx.draft.scheduleText,
          rx.draft.durationText,
          rx.draft.foodRelation,
        ].filter(Boolean);
        return facts.length > 0
          ? `Current staged medicine: ${facts.join(", ")}.`
          : "The current staged medicine form is empty.";
      }
      case "NEXT_MEDICINE":
        return moveMedicine(1);
      case "PREVIOUS_MEDICINE":
        return moveMedicine(-1);
      case "NEXT_FIELD":
        return moveField(1);
      case "PREVIOUS_FIELD":
        return moveField(-1);
      case "REQUEST_REMOVE": {
        if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
        if (rx.editor) return "Finish or cancel the open medicine form before removing a medicine.";
        const row = rx.items[intent.index - 1];
        if (!row) return `Medicine ${intent.index} does not exist. Nothing changed.`;
        rx.setConfirmingRemoval(row);
        return `Removal of medicine ${intent.index} is staged only. Use the visible Remove button to confirm the clinical write.`;
      }
      case "TARGET_FIELD":
        return targetMedicineField(intent.field);
      case "READ_FIELD": {
        if (!rx.editor) return "Open Add medicine or Edit medicine before Read field.";
        targetMedicineField(intent.field);
        const value = rx.draft[intent.field];
        return value
          ? `${M6E_VOICE_FIELD_LABELS[intent.field]}: ${value}`
          : `${M6E_VOICE_FIELD_LABELS[intent.field]} is empty.`;
      }
      case "SET_FIELD": {
        if (!rx.editor || rx.blocked) return "No editable medicine form is available. Nothing changed.";
        stageVoiceDraft({ ...rx.draft, [intent.field]: intent.value });
        targetMedicineField(intent.field);
        return `${M6E_VOICE_FIELD_LABELS[intent.field]} updated in the staged medicine form. Review it before saving.`;
      }
      case "CLEAR_FIELD": {
        if (!rx.editor || rx.blocked) return "No editable medicine form is available. Nothing changed.";
        stageVoiceDraft({ ...rx.draft, [intent.field]: "" });
        targetMedicineField(intent.field);
        return `${M6E_VOICE_FIELD_LABELS[intent.field]} cleared in staged form only.`;
      }
      case "CLEAR_FORM": {
        if (!rx.editor || rx.blocked) return "No editable medicine form is available. Nothing changed.";
        if (rx.editor.mode === "edit") {
          return "Clear medicine form is disabled while editing a saved medicine. Clear individual fields instead.";
        }
        stageVoiceDraft(emptyMedicine());
        targetMedicineField("displayName");
        return "New medicine form cleared. Nothing was written to the prescription.";
      }
      case "UNDO": {
        if (!rx.editor || !voiceUndo.current) return "There is no staged voice edit to undo.";
        const previous = voiceUndo.current;
        voiceUndo.current = { ...rx.draft };
        rx.setDraft(previous);
        const destinationNow = destinationRef.current;
        if (destinationNow.kind === "MEDICINE_FIELD") focusMedicineField(destinationNow.field);
        return "Last staged voice edit undone. No saved prescription row was changed.";
      }
      case "CANCEL_EDITOR": {
        if (!rx.editor) return "No medicine form is open.";
        const medicineIndex = destinationMedicineIndex(destinationRef.current);
        rx.closeEditor();
        commitDestination({ kind: "MEDICINES", medicineIndex });
        voiceUndo.current = null;
        scrollMedicines();
        return "Medicine form closed. Unsaved staged changes were discarded.";
      }
      case "REPLACE_FIELD": {
        const destinationNow = destinationRef.current;
        if (!rx.editor || destinationNow.kind !== "MEDICINE_FIELD" || rx.blocked) {
          return "Choose a medicine field first before using Replace. Nothing changed.";
        }
        const field = destinationNow.field;
        const currentValue = rx.draft[field];
        const at = currentValue.toLocaleLowerCase("en-US").indexOf(intent.from.toLocaleLowerCase("en-US"));
        if (at < 0) {
          return `The current ${M6E_VOICE_FIELD_LABELS[field]} does not contain "${intent.from}". Nothing changed.`;
        }
        const next = currentValue.slice(0, at) + intent.to + currentValue.slice(at + intent.from.length);
        stageVoiceDraft({ ...rx.draft, [field]: next });
        focusMedicineField(field);
        return `${M6E_VOICE_FIELD_LABELS[field]} replacement staged. Review it before saving.`;
      }
      case "STAGE_MEDICINE": {
        if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
        const base = rx.editor ? rx.draft : emptyMedicine();
        if (!rx.editor) rx.openAdd();
        voiceUndo.current = { ...base };
        rx.setDraft({ ...base, ...intent.patch });
        commitDestination({ kind: "MEDICINE_FORM", medicineIndex: null });
        scrollMedicineForm();
        return "Medicine details were structured into the staged form. Nothing is saved until the existing Add medicine/Save changes action is explicitly used.";
      }
      case "TARGET_AUTOPILOT":
        return targetAutopilot();
      case "GENERATE_AUTOPILOT":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current
          ? await autopilotVoiceRef.current.generate()
          : "Autopilot is not available in this prescription context.";
      case "READ_AUTOPILOT":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current?.read() ?? "Autopilot is not available in this prescription context.";
      case "NEXT_AUTOPILOT_ITEM":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current?.next() ?? "Autopilot is not available in this prescription context.";
      case "PREVIOUS_AUTOPILOT_ITEM":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current?.previous() ?? "Autopilot is not available in this prescription context.";
      case "SELECT_AUTOPILOT_MEDICINE":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current?.selectMedicine(intent.index) ?? "Autopilot is not available in this prescription context.";
      case "DESELECT_AUTOPILOT_MEDICINE":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current?.deselectMedicine(intent.index) ?? "Autopilot is not available in this prescription context.";
      case "EDIT_AUTOPILOT_MEDICINE":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current?.editMedicine(intent.index) ?? "Autopilot is not available in this prescription context.";
      case "REMOVE_AUTOPILOT_MEDICINE":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current?.removeMedicine(intent.index) ?? "Autopilot is not available in this prescription context.";
      case "DISCARD_AUTOPILOT":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current
          ? autopilotVoiceRef.current.discard()
          : "Autopilot is not available in this prescription context.";
      case "APPLY_AUTOPILOT":
        commitDestination({ kind: "AUTOPILOT" });
        return autopilotVoiceRef.current
          ? await autopilotVoiceRef.current.apply()
          : "Autopilot is not available in this prescription context.";
      case "OPEN_SIGNED_HISTORY":
        return openSignedMedicineHistory(intent.mode);
      case "OPEN_REUSE_HISTORY":
        return openPreviousPrescriptionReuse();
      case "REVIEW_PRESCRIPTION": {
        if (rx.editor || rx.dirty) return "Finish or cancel the open medicine form before Review.";
        if (rx.confirmingRemoval) return "Resolve the pending medicine removal before Review.";
        if (rx.items.length === 0) return "Add at least one medicine before Review.";
        router.push(`/prescription/${prescriptionId}/review`);
        return "Opening Prescription Review. Final approval still requires the existing explicit doctor action.";
      }
      case "PROHIBITED_FINALIZE":
        return "Voice cannot Finalize, Sign, or Complete a prescription. Open Review and use the protected explicit doctor confirmation there.";
      case "UNKNOWN":
        return "No safe Prescription voice command was recognized. Nothing changed.";
    }
  }

  return {
    contextLabel,
    currentTarget,
    targetOptions,
    selectTarget,
    handleStableTranscript,
    medicineMatches,
    medicineLookupPending,
  };
}
