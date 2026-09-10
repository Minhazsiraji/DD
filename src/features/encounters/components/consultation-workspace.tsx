"use client";

import * as React from "react";
import { CloudAlert, Info, Lock, RefreshCw, Stethoscope } from "lucide-react";
import { ConsultationIdentity } from "./consultation-identity";
import { ConsultationAutosave } from "./consultation-autosave";
import { M2ClinicalNotes } from "./m2-clinical-notes";
import { M2VitalFields } from "./m2-vital-fields";
import { FastEntry } from "./fast-entry";
import { NextVisitFields } from "./next-visit-fields";
import { InvestigationPanel } from "./investigation-panel";
import { resolveVisibility } from "../module-visibility";
import type { RxModuleSetting } from "@/features/doctor/rx-modules";
import type { FollowUpShortcut } from "../follow-up-dates";
import { ConflictPanel } from "./conflict-panel";
import { FindingConflictPanel } from "./finding-conflict-panel";
import { SaveBar } from "./save-bar";
import { UnsavedGuard } from "./unsaved-guard";
import { FindingList } from "./finding-list";
import { PreviousVisitCard } from "./previous-visit-card";
import { OpenPrescriptionButton } from "@/features/prescriptions/components/open-prescription-button";
import { FinishConsultation } from "./finish-consultation";
import { useConsultation } from "../use-consultation";
import {
  addDiagnosisAction,
  removeDiagnosisAction,
  updateDiagnosisAction,
} from "../list-actions";
import { noteInstruction } from "../list-schema";
import { DESYNC_TITLE } from "../version-contract";
import type { FindingRow } from "../finding-types";
import type {
  LocalStagedInvestigation,
  PendingInvestigationConfirmation,
} from "../investigation-v1-ui";
import type { Consultation } from "../queries";
import type { PreviousVisit } from "../previous-visit";

/**
 * M2 Consultation Workspace with Investigation V1 staged confirmation.
 *
 * There is still exactly ONE encounter coordinator, ONE encounter version and
 * ONE MutationGate. Investigation V1 stages locally, then sends one accepted
 * batch confirmation through s.runList so Diagnosis/notes and Investigation
 * continue to share the same encounter mutation boundary.
 */
export function ConsultationWorkspace({
  consultation,
  locationName,
  previousVisit,
  expandPreviousVisit,
  moduleConfig,
  followUpShortcuts,
}: {
  consultation: Consultation;
  locationName: string;
  previousVisit: PreviousVisit | null;
  expandPreviousVisit: boolean;
  moduleConfig: RxModuleSetting[] | null;
  followUpShortcuts: FollowUpShortcut[];
}) {
  const s = useConsultation(consultation);
  const readOnly = consultation.status !== "DRAFT";
  const [stagedInvestigations, setStagedInvestigations] = React.useState<LocalStagedInvestigation[]>([]);
  const [investigationUnknown, setInvestigationUnknown] =
    React.useState<PendingInvestigationConfirmation | null>(null);
  const [investigationActionError, setInvestigationActionError] = React.useState<string | null>(null);

  const visibility = React.useMemo(
    () =>
      resolveVisibility(moduleConfig, consultation.values, {
        diagnoses: consultation.diagnoses.length,
        investigations: consultation.investigations.length,
      }),
    [moduleConfig, consultation],
  );

  /**
   * The only previous-visit values that may be copied into today's encounter.
   * Momentary vitals and visit-specific findings never enter this object.
   */
  const carryForward = React.useMemo(
    () =>
      previousVisit
        ? {
            heightCm: previousVisit.vitals.heightCm,
            weightKg: previousVisit.vitals.weightKg,
            pastHistory: previousVisit.pastHistory,
          }
        : undefined,
    [previousVisit],
  );

  const notesConflict = s.conflict?.notes ?? null;
  const finishBlockedReason = investigationUnknown
    ? "Reconcile the pending Investigation confirmation before finishing this visit."
    : stagedInvestigations.length > 0
      ? "Confirm or remove the locally staged Investigation orders before finishing this visit."
      : s.desynced
        ? "Reload the consultation state before finishing this visit."
        : s.conflict
          ? "Resolve the consultation conflict before finishing this visit."
          : s.busy !== null
            ? "Wait for the current clinical change to finish before closing the visit."
            : s.state.kind === "error"
              ? "The latest note save failed. Retry it before finishing the visit."
              : null;

  function submitDiagnosisEditor() {
    const editor = s.editors.diagnosis;
    if (!editor) return;
    const { draft } = editor;

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
  }

  function confirmRemoveDiagnosis(row: FindingRow) {
    void s.runList("diagnosis", (expectedVersion) =>
      removeDiagnosisAction({
        encounterId: consultation.id,
        expectedVersion,
        rowId: row.id,
      }),
    );
  }

  return (
    <div className="pb-2">
      <UnsavedGuard dirty={(s.anythingUnsaved || stagedInvestigations.length > 0) && !readOnly} />
      {readOnly ? null : (
        <ConsultationAutosave
          values={s.values}
          dirty={s.isDirty}
          blocked={s.blocked || investigationUnknown !== null}
          hasVitalErrors={s.hasVitalErrors}
          state={s.state}
          save={s.save}
        />
      )}

      <div className="sticky top-0 z-30 -mx-4 bg-background/72 px-4 pt-1 pb-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <ConsultationIdentity patient={consultation.patient} locationName={locationName} />
        {readOnly ? null : (
          <div className="mt-2 flex justify-end">
            <FastEntry visibility={visibility} blocked={s.blocked} />
          </div>
        )}
      </div>

      {readOnly ? (
        <p
          role="status"
          className="dd-material-clinical mb-4 flex items-center gap-2 rounded-glass px-4 py-3 text-[13px] font-medium text-ink-secondary"
        >
          <Lock className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          This consultation is {consultation.status === "COMPLETED" ? "completed" : "cancelled"} and can no longer be edited.
        </p>
      ) : null}

      {s.desynced && !investigationUnknown ? (
        <div role="alert" className="dd-material-clinical mb-4 rounded-glass-lg border-l-4 border-l-warning p-4 shadow-soft sm:p-5">
          <div className="flex items-start gap-2.5">
            <CloudAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-ink">{DESYNC_TITLE}</h2>
              <p className="mt-1 text-[13px] text-ink-secondary">{s.desynced.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void s.retrySync()}
            disabled={s.busy !== null}
            className="dd-secondary mt-3 inline-flex h-11 items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:opacity-55 focus-visible:focus-ring"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {s.busy ? "Loading…" : "Retry loading"}
          </button>
        </div>
      ) : null}

      {s.notice ? (
        <p role="status" className="dd-material-clinical mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-glass border-l-4 border-l-brand px-4 py-3 text-[13px] text-ink-secondary">
          <Info className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 flex-1">{s.notice}</span>
          <button
            type="button"
            onClick={s.dismissNotice}
            className="inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {s.conflict?.findings.map((conflict, index) => (
        <div key={`${conflict.kind}-${conflict.list}-${index}`} className="mb-4">
          <FindingConflictPanel conflict={conflict} onResolve={(choice) => s.resolveFinding(conflict, choice)} />
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

      <div
        className={`grid min-w-0 gap-4${
          previousVisit ? " xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start" : ""
        }`}
      >
        {previousVisit ? (
          <aside className="order-1 min-w-0 xl:order-2 xl:sticky xl:top-[188px]">
            <PreviousVisitCard visit={previousVisit} expandedByDefault={expandPreviousVisit} />
          </aside>
        ) : null}

        <main className="order-2 min-w-0 space-y-4 xl:order-1">
          {visibility.VITALS.visible ? (
            <M2VitalFields
              values={s.values}
              dirtyKeys={s.dirtyKeys}
              errors={s.vitalErrors}
              disabled={readOnly}
              onChange={s.setField}
              previous={carryForward ? { heightCm: carryForward.heightCm, weightKg: carryForward.weightKg } : undefined}
              shownBecauseFilled={visibility.VITALS.shownBecauseFilled}
            />
          ) : null}

          <M2ClinicalNotes
            values={s.values}
            dirtyKeys={s.dirtyKeys}
            disabled={readOnly}
            onChange={s.setField}
            visibility={visibility}
            carryForward={carryForward}
          />

          {visibility.DIAGNOSIS.visible ? (
            <FindingList
              kind="diagnosis"
              title="Diagnoses"
              icon={<Stethoscope className="size-4" />}
              rows={s.diagnoses}
              editor={s.editors.diagnosis}
              confirmingRow={s.confirmingRemoval?.list === "diagnosis" ? s.confirmingRemoval.row : null}
              readOnly={readOnly}
              busy={s.busy === "list"}
              blocked={s.blocked || investigationUnknown !== null}
              error={investigationActionError ? null : s.listError}
              suggestions={previousVisit?.diagnoses ?? []}
              onDismissError={s.clearListError}
              onOpenAdd={() => s.openAdd("diagnosis")}
              onOpenEdit={(row) => s.openEdit("diagnosis", row)}
              onCloseEditor={() => s.closeEditor("diagnosis")}
              onDraftChange={(draft) => s.setDraft("diagnosis", draft)}
              onSubmit={submitDiagnosisEditor}
              onAskRemove={(row) => s.askRemove("diagnosis", row)}
              onCancelRemove={s.cancelRemove}
              onConfirmRemove={confirmRemoveDiagnosis}
              shownBecauseFilled={visibility.DIAGNOSIS.shownBecauseFilled}
            />
          ) : null}

          {visibility.INVESTIGATIONS.visible ? (
            <InvestigationPanel
              title="Investigation orders"
              encounterId={consultation.id}
              patientId={consultation.patient.id}
              confirmed={s.investigations}
              staged={stagedInvestigations}
              readOnly={readOnly}
              busy={s.busy === "list"}
              blocked={s.blocked}
              unknown={investigationUnknown}
              actionError={investigationActionError}
              runList={s.runList}
              retrySync={s.retrySync}
              clearCoordinatorError={s.clearListError}
              onStagedChange={setStagedInvestigations}
              onUnknownChange={setInvestigationUnknown}
              onActionErrorChange={setInvestigationActionError}
              shownBecauseFilled={visibility.INVESTIGATIONS.shownBecauseFilled}
            />
          ) : null}

          {visibility.NEXT_VISIT.visible ? (
            <NextVisitFields
              values={s.values}
              dirtyKeys={s.dirtyKeys}
              disabled={readOnly}
              onChange={s.setField}
              shortcuts={followUpShortcuts}
              shownBecauseFilled={visibility.NEXT_VISIT.shownBecauseFilled}
            />
          ) : null}

          {readOnly ? null : <OpenPrescriptionButton encounterId={consultation.id} />}

          {readOnly ? null : (
            <FinishConsultation
              encounterId={consultation.id}
              version={s.version}
              unsaved={s.anythingUnsaved}
              blockedReason={finishBlockedReason}
            />
          )}
        </main>
      </div>

      {readOnly ? null : (
        <SaveBar
          state={s.state}
          dirtyCount={s.dirtyKeys.length}
          blocked={s.blocked || investigationUnknown !== null}
          hasVitalErrors={s.hasVitalErrors}
          onRetry={() => void s.save()}
        />
      )}
    </div>
  );
}
