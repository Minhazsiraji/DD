"use client";

import * as React from "react";
import { CloudAlert, Lock, RefreshCw, Stethoscope, TestTube } from "lucide-react";
import { ConsultationIdentity } from "./consultation-identity";
import { SectionFields, VitalFields } from "./draft-fields";
import { ConflictPanel } from "./conflict-panel";
import { FindingConflictPanel } from "./finding-conflict-panel";
import { SaveBar } from "./save-bar";
import { UnsavedGuard } from "./unsaved-guard";
import { FindingList } from "./finding-list";
import { useConsultation } from "../use-consultation";
import {
  addDiagnosisAction,
  addInvestigationAction,
  removeDiagnosisAction,
  removeInvestigationAction,
  updateDiagnosisAction,
  updateInvestigationAction,
} from "../list-actions";
import { noteInstruction } from "../list-schema";
import type { FindingRow, ListKind } from "../finding-types";
import type { Consultation } from "../queries";

/**
 * The consultation screen.
 *
 * Notes, vitals, diagnoses and investigations sit on ONE coordinator with ONE
 * version and ONE mutation queue (ADR 0010 §6c). Conflicts are raised by that
 * coordinator with a SUBJECT — a refused diagnosis edit asks about diagnoses,
 * not about the examination note — and every subject must be settled before
 * anything else may be written.
 *
 * Read-only once the encounter leaves DRAFT: no add, edit or remove control is
 * rendered at all, rather than rendered and refused.
 */
export function ConsultationWorkspace({
  consultation,
  locationName,
}: {
  consultation: Consultation;
  locationName: string;
}) {
  const s = useConsultation(consultation);
  const readOnly = consultation.status !== "DRAFT";
  const notesConflict = s.conflict?.notes ?? null;

  function submitEditor(list: ListKind) {
    const editor = s.editors[list];
    if (!editor) return;
    const { draft } = editor;

    if (list === "diagnosis") {
      if (editor.mode === "add") {
        void s.runList("diagnosis", (expectedVersion) =>
          addDiagnosisAction({
            encounterId: consultation.id,
            expectedVersion,
            label: draft.title,
            certainty: draft.certainty,
            note: draft.note,
          }),
        );
        return;
      }
      void s.runList("diagnosis", (expectedVersion) =>
        updateDiagnosisAction({
          encounterId: consultation.id,
          expectedVersion,
          diagnosisId: editor.rowId!,
          label: draft.title,
          certainty: draft.certainty,
          note: noteInstruction(draft.note),
        }),
      );
      return;
    }

    if (editor.mode === "add") {
      void s.runList("investigation", (expectedVersion) =>
        addInvestigationAction({
          encounterId: consultation.id,
          expectedVersion,
          name: draft.title,
          note: draft.note,
        }),
      );
      return;
    }
    void s.runList("investigation", (expectedVersion) =>
      updateInvestigationAction({
        encounterId: consultation.id,
        expectedVersion,
        investigationId: editor.rowId!,
        name: draft.title,
        note: noteInstruction(draft.note),
      }),
    );
  }

  function confirmRemove(list: ListKind, row: FindingRow) {
    const action = list === "diagnosis" ? removeDiagnosisAction : removeInvestigationAction;
    void s.runList(list, (expectedVersion) =>
      action({ encounterId: consultation.id, expectedVersion, rowId: row.id }),
    );
  }

  return (
    <div className="pb-2">
      {/* Notes draft AND any unfinished finding form. */}
      <UnsavedGuard dirty={s.anythingUnsaved && !readOnly} />

      <div className="sticky top-0 z-30 -mx-4 bg-background/80 px-4 pt-1 pb-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <ConsultationIdentity patient={consultation.patient} locationName={locationName} />
      </div>

      {readOnly ? (
        <p
          role="status"
          className="clinical-surface mb-4 flex items-center gap-2 rounded-glass px-4 py-3 text-[13px] font-medium text-ink-secondary"
        >
          <Lock className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          This consultation is {consultation.status === "COMPLETED" ? "completed" : "cancelled"} and
          can no longer be edited.
        </p>
      ) : null}

      {/*
        The write landed but the read did not. Says so without implying failure
        — implying failure is what makes a doctor record the same finding twice.
      */}
      {s.desynced ? (
        <div
          role="alert"
          className="clinical-surface mb-4 rounded-glass-lg border-l-4 border-l-warning p-4 shadow-soft sm:p-5"
        >
          <div className="flex items-start gap-2.5">
            <CloudAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-ink">
                The list below may be out of date
              </h2>
              <p className="mt-1 text-[13px] text-ink-secondary">{s.desynced}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void s.retrySync()}
            disabled={s.busy !== null}
            className="mt-3 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover disabled:opacity-55 focus-visible:focus-ring"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {s.busy ? "Loading…" : "Retry loading"}
          </button>
        </div>
      ) : null}

      {/* One panel per unsettled decision, each about its own subject. */}
      {s.conflict?.findings.map((c, i) => (
        <div key={`${c.kind}-${c.list}-${i}`} className="mb-4">
          <FindingConflictPanel conflict={c} onResolve={(choice) => s.resolveFinding(c, choice)} />
        </div>
      ))}

      {notesConflict ? (
        <div className="mb-4">
          <ConflictPanel
            message={s.conflict!.message}
            mine={s.values}
            theirs={notesConflict.theirs}
            unsavedKeys={s.dirtyKeys}
            onKeepMine={s.keepMine}
            onTakeTheirs={s.takeTheirs}
          />
        </div>
      ) : null}

      <div className="space-y-4">
        <VitalFields
          values={s.values}
          dirtyKeys={s.dirtyKeys}
          errors={s.vitalErrors}
          disabled={readOnly}
          onChange={s.setField}
        />
        <SectionFields
          values={s.values}
          dirtyKeys={s.dirtyKeys}
          disabled={readOnly}
          onChange={s.setField}
        />

        <FindingList
          kind="diagnosis"
          title="Diagnoses"
          icon={<Stethoscope className="size-4" />}
          rows={s.diagnoses}
          editor={s.editors.diagnosis}
          confirmingRow={s.confirmingRemoval?.list === "diagnosis" ? s.confirmingRemoval.row : null}
          readOnly={readOnly}
          busy={s.busy === "list"}
          blocked={s.blocked}
          error={s.listError}
          onDismissError={s.clearListError}
          onOpenAdd={() => s.openAdd("diagnosis")}
          onOpenEdit={(row) => s.openEdit("diagnosis", row)}
          onCloseEditor={() => s.closeEditor("diagnosis")}
          onDraftChange={(draft) => s.setDraft("diagnosis", draft)}
          onSubmit={() => submitEditor("diagnosis")}
          onAskRemove={(row) => s.askRemove("diagnosis", row)}
          onCancelRemove={s.cancelRemove}
          onConfirmRemove={(row) => confirmRemove("diagnosis", row)}
        />

        <FindingList
          kind="investigation"
          title="Investigations"
          icon={<TestTube className="size-4" />}
          rows={s.investigations}
          editor={s.editors.investigation}
          confirmingRow={
            s.confirmingRemoval?.list === "investigation" ? s.confirmingRemoval.row : null
          }
          readOnly={readOnly}
          busy={s.busy === "list"}
          blocked={s.blocked}
          error={s.listError}
          onDismissError={s.clearListError}
          onOpenAdd={() => s.openAdd("investigation")}
          onOpenEdit={(row) => s.openEdit("investigation", row)}
          onCloseEditor={() => s.closeEditor("investigation")}
          onDraftChange={(draft) => s.setDraft("investigation", draft)}
          onSubmit={() => submitEditor("investigation")}
          onAskRemove={(row) => s.askRemove("investigation", row)}
          onCancelRemove={s.cancelRemove}
          onConfirmRemove={(row) => confirmRemove("investigation", row)}
        />
      </div>

      {readOnly ? null : (
        <SaveBar
          state={s.state}
          dirtyCount={s.dirtyKeys.length}
          disabled={s.state.kind === "saving" || s.blocked || !s.isDirty || s.hasVitalErrors}
          onSave={s.save}
        />
      )}
    </div>
  );
}
