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
  const voiceUndo = React.useRef<MedicineDraft | null>(null);

  const contextLabel = React.useMemo(() => {
    if (!rx.editor) return "Prescription";
    const base = rx.editor.mode === "add"
      ? "New medicine"
      : `Medicine ${rx.editor.row.position}: ${rx.editor.row.display_name}`;
    return voiceField ? `${base} · ${FIELD_LABELS[voiceField]}` : base;
  }, [rx.editor, voiceField]);

  function stageVoiceDraft(next: MedicineDraft) {
    voiceUndo.current = { ...rx.draft };
    rx.setDraft(next);
  }

  async function handleStableTranscript(text: string): Promise<string> {
    const intent = parseM6EPrescriptionVoice(text, {
      editorOpen: rx.editor !== null,
      fieldTarget: voiceField,
    });

    if (readOnly) return "This prescription is approved and read-only. Nothing changed.";

    switch (intent.type) {
      case "OPEN_ADD": {
        if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
        if (rx.editor) return "A medicine form is already open. Finish or cancel it first.";
        rx.openAdd();
        setVoiceField("displayName");
        setVoiceCursor(null);
        voiceUndo.current = null;
        return "New medicine form opened. Voice target is Medicine. Dictation stays staged until you explicitly add it.";
      }
      case "EDIT_MEDICINE": {
        if (rx.blocked) return "Prescription editing is currently blocked. Nothing changed.";
        if (rx.editor && rx.dirty) return "Finish or cancel the current unsaved medicine before editing another one.";
        const row = rx.items[intent.index - 1];
        if (!row) return `Medicine ${intent.index} does not exist. Nothing changed.`;
        rx.openEdit(row);
        setVoiceCursor(intent.index - 1);
        setVoiceField(null);
        voiceUndo.current = null;
        return `Medicine ${intent.index} opened for staged editing. Saving still requires the existing explicit Save changes action.`;
      }
      case "NEXT_MEDICINE":
      case "PREVIOUS_MEDICINE": {
        if (rx.items.length === 0) return "There are no saved medicines to navigate.";
        if (rx.editor && rx.dirty) return "Finish or cancel the current unsaved medicine before moving to another medicine.";
        const current = rx.editor?.mode === "edit"
          ? rx.items.findIndex((row) => row.id === rx.editor?.row.id)
          : voiceCursor ?? (intent.type === "NEXT_MEDICINE" ? -1 : rx.items.length);
        const next = intent.type === "NEXT_MEDICINE" ? current + 1 : current - 1;
        if (next < 0 || next >= rx.items.length) {
          return intent.type === "NEXT_MEDICINE" ? "Already at the last medicine." : "Already at the first medicine.";
        }
        const row = rx.items[next]!;
        rx.openEdit(row);
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
        return `Voice target set to ${FIELD_LABELS[intent.field]}. The next ordinary utterance edits only that staged field.`;
      }
      case "SET_FIELD": {
        if (!rx.editor || rx.blocked) return "No editable medicine form is available. Nothing changed.";
        stageVoiceDraft({ ...rx.draft, [intent.field]: intent.value });
        return `${FIELD_LABELS[intent.field]} updated in the staged medicine form. Review it before saving.`;
      }
      case "CLEAR_FIELD": {
        if (!rx.editor || rx.blocked) return "No editable medicine form is available. Nothing changed.";
        stageVoiceDraft({ ...rx.draft, [intent.field]: "" });
        setVoiceField(intent.field);
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
        setVoiceField(null);
        setVoiceCursor(null);
        return "Medicine details were structured into the staged form. Nothing is saved until the existing Add medicine/Save changes action is explicitly used.";
      }
      case "GENERATE_AUTOPILOT":
        return autopilotVoiceRef.current
          ? await autopilotVoiceRef.current.generate()
          : "Autopilot is not available in this prescription context.";
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
