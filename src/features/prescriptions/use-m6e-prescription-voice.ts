"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { M6C2AutopilotVoiceHandle } from "@/features/autopilot/components/m6c2-autopilot-panel";
import { parseM6EPrescriptionVoice, type M6EVoiceMedicineField } from "./m6e-prescription-voice-contract";
import { emptyMedicine, type MedicineDraft } from "./schema";
import type { usePrescription } from "./use-prescription";

const FIELD_LABELS: Record<M6EVoiceMedicineField, string> = {
  displayName: "Medicine",
  brandName: "Brand",
  genericName: "Generic",
  strengthText: "Strength",
  doseText: "Dose",
  dosageForm: "Form",
  route: "Route",
  scheduleText: "Schedule",
  durationText: "Duration",
  quantityText: "Quantity",
  foodRelation: "Food relation",
  instructions: "Instructions",
};

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
  const [voiceField, setVoiceField] = React.useState<M6EVoiceMedicineField | null>(null);
  const [voiceCursor, setVoiceCursor] = React.useState<number | null>(null);
  const [voiceSurface, setVoiceSurface] = React.useState<"medicines" | "autopilot">("medicines");
  const voiceUndo = React.useRef<MedicineDraft | null>(null);

  const contextLabel = React.useMemo(() => {
    if (voiceSurface === "autopilot") return "Prescription · Autopilot";
    if (!rx.editor) return "Prescription · Medicines";
    const base = rx.editor.mode === "add"
      ? "Prescription · New medicine"
      : `Prescription · Medicine ${rx.editor.row.position}: ${rx.editor.row.display_name}`;
    return voiceField ? `${base} · ${FIELD_LABELS[voiceField]}` : base;
  }, [rx.editor, voiceField, voiceSurface]);

  function focusMedicineField(field: M6EVoiceMedicineField) {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-medicine-field="${field}"]`)?.focus();
    });
  }

  function openMedicine(index: number, label: "targeted" | "editing"): string {
    if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
    if (rx.editor && rx.dirty) return "Finish or cancel the current unsaved medicine before opening another one.";
    const row = rx.items[index - 1];
    if (!row) return `Medicine ${index} does not exist. Nothing changed.`;
    rx.openEdit(row);
    setVoiceSurface("medicines");
    setVoiceCursor(index - 1);
    setVoiceField(null);
    voiceUndo.current = null;
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-medicine-form]")?.scrollIntoView({ block: "nearest" }));
    return `Medicine ${index} opened for staged ${label}. Saving still requires the existing explicit Save changes action.`;
  }

  function stageVoiceDraft(next: MedicineDraft) {
    voiceUndo.current = { ...rx.draft };
    rx.setDraft(next);
  }

  async function handleStableTranscript(text: string): Promise<string> {
    const intent = parseM6EPrescriptionVoice(text, {
      editorOpen: rx.editor !== null,
      fieldTarget: voiceField,
      autopilotProposalActive: voiceSurface === "autopilot" && (autopilotVoiceRef.current?.hasProposal() ?? false),
    });

    if (readOnly) return "This prescription is approved and read-only. Nothing changed.";

    switch (intent.type) {
      case "TARGET_MEDICINES": {
        setVoiceSurface("medicines");
        document.querySelector<HTMLElement>("[data-m6e-medicines]")?.scrollIntoView({ block: "start", behavior: "smooth" });
        return "Voice target is Prescription · Medicines. No clinical field changed.";
      }
      case "OPEN_ADD": {
        if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
        if (rx.editor) return "A medicine form is already open. Finish or cancel it first.";
        rx.openAdd();
        setVoiceSurface("medicines");
        setVoiceField("displayName");
        setVoiceCursor(null);
        voiceUndo.current = null;
        focusMedicineField("displayName");
        return "New medicine form opened. Voice target is Medicine. Dictation stays staged until you explicitly add it.";
      }
      case "TARGET_MEDICINE":
        return openMedicine(intent.index, "targeted");
      case "EDIT_MEDICINE": {
        return openMedicine(intent.index, "editing");
      }
      case "READ_MEDICINE": {
        if (!rx.editor) return "Open or target a medicine before Read medicine.";
        const facts = [rx.draft.displayName, rx.draft.strengthText, rx.draft.doseText, rx.draft.scheduleText, rx.draft.durationText, rx.draft.foodRelation].filter(Boolean);
        return facts.length > 0 ? `Current staged medicine: ${facts.join(", ")}.` : "The current staged medicine form is empty.";
      }
      case "NEXT_MEDICINE":
      case "PREVIOUS_MEDICINE": {
        if (rx.items.length === 0) return "There are no saved medicines to navigate.";
        if (rx.editor && rx.dirty) return "Finish or cancel the current unsaved medicine before moving to another medicine.";
        const activeEditor = rx.editor;
        const current = activeEditor?.mode === "edit"
          ? rx.items.findIndex((row) => row.id === activeEditor.row.id)
          : voiceCursor ?? (intent.type === "NEXT_MEDICINE" ? -1 : rx.items.length);
        const next = intent.type === "NEXT_MEDICINE" ? current + 1 : current - 1;
        if (next < 0 || next >= rx.items.length) {
          return intent.type === "NEXT_MEDICINE" ? "Already at the last medicine." : "Already at the first medicine.";
        }
        const row = rx.items[next]!;
        rx.openEdit(row);
        setVoiceSurface("medicines");
        setVoiceCursor(next);
        setVoiceField(null);
        voiceUndo.current = null;
        return `Medicine ${next + 1} opened for staged editing.`;
      }
      case "REQUEST_REMOVE": {
        if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
        if (rx.editor) return "Finish or cancel the open medicine form before removing a medicine.";
        const row = rx.items[intent.index - 1];
        if (!row) return `Medicine ${intent.index} does not exist. Nothing changed.`;
        rx.setConfirmingRemoval(row);
        return `Removal of medicine ${intent.index} is staged only. Use the visible Remove button to confirm the clinical write.`;
      }
      case "TARGET_FIELD": {
        if (!rx.editor) return "Open Add medicine or Edit medicine first, then choose a medicine field.";
        setVoiceField(intent.field);
        setVoiceSurface("medicines");
        focusMedicineField(intent.field);
        return `Voice target set to ${FIELD_LABELS[intent.field]}. The next ordinary utterance edits only that staged field.`;
      }
      case "SET_FIELD": {
        if (!rx.editor || rx.blocked) return "No editable medicine form is available. Nothing changed.";
        stageVoiceDraft({ ...rx.draft, [intent.field]: intent.value });
        setVoiceSurface("medicines");
        setVoiceField(intent.field);
        focusMedicineField(intent.field);
        return `${FIELD_LABELS[intent.field]} updated in the staged medicine form. Review it before saving.`;
      }
      case "CLEAR_FIELD": {
        if (!rx.editor || rx.blocked) return "No editable medicine form is available. Nothing changed.";
        stageVoiceDraft({ ...rx.draft, [intent.field]: "" });
        setVoiceField(intent.field);
        focusMedicineField(intent.field);
        return `${FIELD_LABELS[intent.field]} cleared in staged form only.`;
      }
      case "CLEAR_FORM": {
        if (!rx.editor || rx.blocked) return "No editable medicine form is available. Nothing changed.";
        if (rx.editor.mode === "edit") return "Clear medicine form is disabled while editing a saved medicine. Clear individual fields instead.";
        stageVoiceDraft(emptyMedicine());
        setVoiceField("displayName");
        return "New medicine form cleared. Nothing was written to the prescription.";
      }
      case "UNDO": {
        if (!rx.editor || !voiceUndo.current) return "There is no staged voice edit to undo.";
        const previous = voiceUndo.current;
        voiceUndo.current = { ...rx.draft };
        rx.setDraft(previous);
        return "Last staged voice edit undone. No saved prescription row was changed.";
      }
      case "CANCEL_EDITOR": {
        if (!rx.editor) return "No medicine form is open.";
        rx.closeEditor();
        setVoiceField(null);
        setVoiceCursor(null);
        voiceUndo.current = null;
        return "Medicine form closed. Unsaved staged changes were discarded.";
      }
      case "REPLACE_FIELD": {
        if (!rx.editor || !voiceField || rx.blocked) return "Choose a medicine field first before using Replace. Nothing changed.";
        const current = rx.draft[voiceField];
        const at = current.toLocaleLowerCase("en-US").indexOf(intent.from.toLocaleLowerCase("en-US"));
        if (at < 0) return `The current ${FIELD_LABELS[voiceField]} does not contain "${intent.from}". Nothing changed.`;
        const next = current.slice(0, at) + intent.to + current.slice(at + intent.from.length);
        stageVoiceDraft({ ...rx.draft, [voiceField]: next });
        return `${FIELD_LABELS[voiceField]} replacement staged. Review it before saving.`;
      }
      case "STAGE_MEDICINE": {
        if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
        const base = rx.editor ? rx.draft : emptyMedicine();
        if (!rx.editor) rx.openAdd();
        voiceUndo.current = { ...base };
        rx.setDraft({ ...base, ...intent.patch });
        setVoiceSurface("medicines");
        setVoiceField(null);
        setVoiceCursor(null);
        return "Medicine details were structured into the staged form. Nothing is saved until the existing Add medicine/Save changes action is explicitly used.";
      }
      case "TARGET_AUTOPILOT":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current?.target() ?? "Autopilot is not available in this prescription context.";
      case "GENERATE_AUTOPILOT":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current ? await autopilotVoiceRef.current.generate() : "Autopilot is not available in this prescription context.";
      case "READ_AUTOPILOT":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current?.read() ?? "Autopilot is not available in this prescription context.";
      case "NEXT_AUTOPILOT_ITEM":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current?.next() ?? "Autopilot is not available in this prescription context.";
      case "PREVIOUS_AUTOPILOT_ITEM":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current?.previous() ?? "Autopilot is not available in this prescription context.";
      case "SELECT_AUTOPILOT_MEDICINE":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current?.selectMedicine(intent.index) ?? "Autopilot is not available in this prescription context.";
      case "DESELECT_AUTOPILOT_MEDICINE":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current?.deselectMedicine(intent.index) ?? "Autopilot is not available in this prescription context.";
      case "EDIT_AUTOPILOT_MEDICINE":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current?.editMedicine(intent.index) ?? "Autopilot is not available in this prescription context.";
      case "REMOVE_AUTOPILOT_MEDICINE":
        setVoiceSurface("autopilot");
        return autopilotVoiceRef.current?.removeMedicine(intent.index) ?? "Autopilot is not available in this prescription context.";
      case "DISCARD_AUTOPILOT":
        return autopilotVoiceRef.current
          ? autopilotVoiceRef.current.discard()
          : "Autopilot is not available in this prescription context.";
      case "APPLY_AUTOPILOT":
        return autopilotVoiceRef.current
          ? await autopilotVoiceRef.current.apply()
          : "Autopilot is not available in this prescription context.";
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

  return { contextLabel, handleStableTranscript };
}
