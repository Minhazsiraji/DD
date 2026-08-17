"use client";

import * as React from "react";
import { Lock, Stethoscope, TestTube } from "lucide-react";
import { ConsultationIdentity } from "./consultation-identity";
import { SectionFields, VitalFields } from "./draft-fields";
import { ConflictPanel } from "./conflict-panel";
import { SaveBar } from "./save-bar";
import { UnsavedGuard } from "./unsaved-guard";
import { FindingList, type FindingRow } from "./finding-list";
import type { FindingDraft } from "./finding-form";
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
import type { Consultation } from "../queries";

/**
 * The consultation screen.
 *
 * Notes, vitals, diagnoses and investigations all sit on ONE coordinator with
 * ONE version and ONE queue (ADR 0010 §6c) — a second version counter here
 * would let the screen conflict with its own previous click.
 *
 * Read-only once the encounter leaves DRAFT: completed records are corrected
 * through Stage 9's amendment path, so no add, edit or remove control is
 * rendered at all rather than rendered and refused.
 */
export function ConsultationWorkspace({
  consultation,
  locationName,
}: {
  consultation: Consultation;
  locationName: string;
}) {
  const session = useConsultation(consultation);
  const readOnly = consultation.status !== "DRAFT";
  const conflict = session.state.kind === "conflict" ? session.state : null;

  // A half-written finding is unsaved clinical text too, so the navigation
  // guard has to know about it.
  const [dxFormDirty, setDxFormDirty] = React.useState(false);
  const [invFormDirty, setInvFormDirty] = React.useState(false);
  const anythingUnsaved = session.isDirty || dxFormDirty || invFormDirty;

  const busy = session.busy;
  const blocked = busy !== null || conflict !== null;

  const diagnosisRows: FindingRow[] = session.diagnoses.map((d) => ({
    id: d.id,
    title: d.label,
    note: d.note,
    position: d.position,
    certainty: d.certainty,
  }));

  const investigationRows: FindingRow[] = session.investigations.map((i) => ({
    id: i.id,
    title: i.name,
    note: i.note,
    position: i.position,
  }));

  return (
    <div className="pb-2">
      {/*
        Covers reload, every internal link in the shell, and Back/Forward — for
        the notes draft AND an unfinished finding form.
      */}
      <UnsavedGuard dirty={anythingUnsaved && !readOnly} />

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

      {conflict ? (
        <div className="mb-4">
          <ConflictPanel
            message={conflict.message}
            mine={session.values}
            theirs={conflict.theirs}
            unsavedKeys={session.dirtyKeys}
            onKeepMine={session.keepMine}
            onTakeTheirs={session.takeTheirs}
          />
        </div>
      ) : null}

      <div className="space-y-4">
        <VitalFields
          values={session.values}
          dirtyKeys={session.dirtyKeys}
          errors={session.vitalErrors}
          disabled={readOnly}
          onChange={session.setField}
        />
        <SectionFields
          values={session.values}
          dirtyKeys={session.dirtyKeys}
          disabled={readOnly}
          onChange={session.setField}
        />

        <FindingList
          kind="diagnosis"
          title="Diagnoses"
          icon={<Stethoscope className="size-4" />}
          rows={diagnosisRows}
          readOnly={readOnly}
          busy={busy === "list"}
          blocked={blocked}
          error={session.listError}
          onDismissError={session.clearListError}
          onDirtyChange={setDxFormDirty}
          onAdd={(draft: FindingDraft) =>
            session.runList((expectedVersion) =>
              addDiagnosisAction({
                encounterId: consultation.id,
                expectedVersion,
                label: draft.title,
                certainty: draft.certainty,
                note: draft.note,
              }),
            )
          }
          onUpdate={(row, draft) =>
            session.runList((expectedVersion) =>
              updateDiagnosisAction({
                encounterId: consultation.id,
                expectedVersion,
                diagnosisId: row.id,
                label: draft.title,
                certainty: draft.certainty,
                // "" is an explicit clear, which is why it is sent as null
                // rather than simply omitted.
                note: noteInstruction(draft.note),
              }),
            )
          }
          onRemove={(row) =>
            session.runList((expectedVersion) =>
              removeDiagnosisAction({
                encounterId: consultation.id,
                expectedVersion,
                rowId: row.id,
              }),
            )
          }
        />

        <FindingList
          kind="investigation"
          title="Investigations"
          icon={<TestTube className="size-4" />}
          rows={investigationRows}
          readOnly={readOnly}
          busy={busy === "list"}
          blocked={blocked}
          error={session.listError}
          onDismissError={session.clearListError}
          onDirtyChange={setInvFormDirty}
          onAdd={(draft) =>
            session.runList((expectedVersion) =>
              addInvestigationAction({
                encounterId: consultation.id,
                expectedVersion,
                name: draft.title,
                note: draft.note,
              }),
            )
          }
          onUpdate={(row, draft) =>
            session.runList((expectedVersion) =>
              updateInvestigationAction({
                encounterId: consultation.id,
                expectedVersion,
                investigationId: row.id,
                name: draft.title,
                note: noteInstruction(draft.note),
              }),
            )
          }
          onRemove={(row) =>
            session.runList((expectedVersion) =>
              removeInvestigationAction({
                encounterId: consultation.id,
                expectedVersion,
                rowId: row.id,
              }),
            )
          }
        />
      </div>

      {readOnly ? null : (
        <SaveBar
          state={session.state}
          dirtyCount={session.dirtyKeys.length}
          disabled={
            session.state.kind === "saving" ||
            busy !== null ||
            !session.isDirty ||
            session.hasVitalErrors ||
            conflict !== null
          }
          onSave={session.save}
        />
      )}
    </div>
  );
}
