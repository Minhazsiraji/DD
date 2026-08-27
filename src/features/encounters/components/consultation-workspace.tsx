"use client";

import * as React from "react";
import { CloudAlert, Info, Lock, RefreshCw, Stethoscope, TestTube } from "lucide-react";
import { ConsultationIdentity } from "./consultation-identity";
import { SectionFields, VitalFields } from "./draft-fields";
import { FastEntry } from "./fast-entry";
import { NextVisitFields } from "./next-visit-fields";
import { resolveVisibility } from "../module-visibility";
import type { RxModuleSetting } from "@/features/doctor/rx-modules";
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
  addInvestigationAction,
  removeDiagnosisAction,
  removeInvestigationAction,
  updateDiagnosisAction,
  updateInvestigationAction,
} from "../list-actions";
import { noteInstruction } from "../list-schema";
import { DESYNC_TITLE } from "../version-contract";
import type { FindingRow, ListKind } from "../finding-types";
import type { Consultation } from "../queries";
import type { PreviousVisit } from "../previous-visit";

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
  previousVisit,
  expandPreviousVisit,
  moduleConfig,
}: {
  consultation: Consultation;
  locationName: string;
  /** The immediately preceding COMPLETED visit, or null for a first visit. */
  previousVisit: PreviousVisit | null;
  /** Open on arrival for a report review or a follow-up — visits about it. */
  expandPreviousVisit: boolean;
  /**
   * The doctor's section configuration, or null when it could not be read —
   * which shows everything rather than hiding a field over a failed query.
   */
  moduleConfig: RxModuleSetting[] | null;
}) {
  const s = useConsultation(consultation);
  const readOnly = consultation.status !== "DRAFT";

  /**
   * WHAT THE DOCTOR SEES — settled from the SAVED encounter, once.
   *
   * `consultation.values` and the loaded findings, deliberately, not `s.values`
   * and `s.diagnoses`. Deciding from what is being typed would make a section
   * vanish the moment its last character was deleted and reappear on the next
   * keystroke — layout jumping the doctor would then have to type around.
   *
   * A section that is empty and turned off is hidden; one that already holds
   * something is ALWAYS shown, whatever the setting says. Configuration
   * simplifies future input; it never makes recorded information disappear.
   */
  const visibility = React.useMemo(
    () =>
      resolveVisibility(moduleConfig, consultation.values, {
        diagnoses: consultation.diagnoses.length,
        investigations: consultation.investigations.length,
      }),
    [moduleConfig, consultation],
  );

  /**
   * The three values from last time that a doctor may reasonably reuse.
   *
   * Derived here rather than passed as its own prop so there is exactly one
   * place that decides what is carryable — and so it is obvious that everything
   * else on `previousVisit` is display-only.
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

  function submitEditor(list: ListKind) {
    const editor = s.editors[list];
    if (!editor) return;
    const { draft } = editor;

    if (list === "diagnosis") {
      if (editor.mode === "add") {
        void s.runList(
          "diagnosis",
          (expectedVersion) =>
            addDiagnosisAction({
              encounterId: consultation.id,
              expectedVersion,
              label: draft.title,
              certainty: draft.certainty,
              note: draft.note,
            }),
          // Adds only, and only on a CONFIRMED success: the form stays open
          // with an empty draft so the next diagnosis can be typed straight in.
          { resetDraftOnSuccess: true },
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
      void s.runList(
        "investigation",
        (expectedVersion) =>
          addInvestigationAction({
            encounterId: consultation.id,
            expectedVersion,
            name: draft.title,
            note: draft.note,
          }),
        { resetDraftOnSuccess: true },
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

        {/*
          FAST ENTRY — focus only.

          Given the SAME `visibility` the sections below render from, so the
          palette cannot offer a section that is not on screen. Inert while the
          coordinator is blocked, and absent entirely on a finished consultation
          where there is nothing to type into.
        */}
        {readOnly ? null : (
          <div className="mt-2 flex justify-end">
            <FastEntry visibility={visibility} blocked={s.blocked} />
          </div>
        )}
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
        Something about the record is unknown. Two very different unknowns —
        "may already have saved" and "was definitely refused" — and the copy
        must not blur them: one would make a doctor enter a finding twice, the
        other would make them retype work that is still on the screen.
      */}
      {s.desynced ? (
        <div
          role="alert"
          className="clinical-surface mb-4 rounded-glass-lg border-l-4 border-l-warning p-4 shadow-soft sm:p-5"
        >
          <div className="flex items-start gap-2.5">
            <CloudAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            {/*
              Neutral title: the unknown may be the notes, the lists, or the
              encounter version itself. "The list below may be out of date" was
              wrong for a rejected note save. The MESSAGE carries the part that
              actually matters — whether the change may have landed, or
              definitely did not.
            */}
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-ink">{DESYNC_TITLE}</h2>
              <p className="mt-1 text-[13px] text-ink-secondary">{s.desynced.message}</p>
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

      {/*
        The encounter moved but nothing here disagreed with it. Informational,
        dismissible, and NOT a conflict — storing a conflict with no subject is
        what left the screen blocked with nothing to settle.
      */}
      {s.notice ? (
        <p
          role="status"
          className="clinical-surface mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-glass border-l-4 border-l-brand px-4 py-3 text-[13px] text-ink-secondary"
        >
          <Info className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 flex-1">{s.notice}</span>
          <button
            type="button"
            onClick={s.dismissNotice}
            className="inline-flex h-11 items-center rounded-xl px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
          >
            Dismiss
          </button>
        </p>
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
        {/*
          What happened last time, ABOVE today's fields and read-only.

          A returning patient used to arrive at a blank consultation, and the
          doctor had to leave the screen and search the timeline to remember
          their own last visit. It sits first because that is when it is
          useful — after the notes are written it is just history.

          It never writes into anything below it. See `previous-visit-card`.
        */}
        {previousVisit ? (
          <>
            <PreviousVisitCard visit={previousVisit} expandedByDefault={expandPreviousVisit} />

            {/*
              THE LINE BETWEEN THEN AND NOW.

              With the previous visit expanded, the screen shows two sets of
              vitals and two assessments, and the second set is the editable
              one. A doctor scrolling past a filled-in card into empty fields
              needs to know without thinking which is which — so the boundary
              is stated rather than implied by spacing.

              Only rendered when there IS a previous visit; on a first visit
              there is nothing to divide.
            */}
            <div className="flex items-center gap-3 pt-1" aria-hidden="true">
              <span className="h-px flex-1 bg-hairline" />
              <span className="text-[11px] font-semibold tracking-[0.14em] text-ink-muted uppercase">
                Today&rsquo;s visit
              </span>
              <span className="h-px flex-1 bg-hairline" />
            </div>
          </>
        ) : null}

        {/*
          Offered, never applied. `carryForward` puts last visit's height,
          weight and past history under the matching empty field with a "Use
          previous" press — and nothing else is offered, because everything else
          is an observation of a visit rather than a standing fact.
        */}
        {visibility.VITALS.visible ? (
          <VitalFields
            values={s.values}
            dirtyKeys={s.dirtyKeys}
            errors={s.vitalErrors}
            disabled={readOnly}
            onChange={s.setField}
            carryForward={carryForward}
            shownBecauseFilled={visibility.VITALS.shownBecauseFilled}
          />
        ) : null}

        <SectionFields
          values={s.values}
          dirtyKeys={s.dirtyKeys}
          disabled={readOnly}
          onChange={s.setField}
          carryForward={carryForward}
          visibility={visibility}
        />

        {visibility.NEXT_VISIT.visible ? (
          <NextVisitFields
            values={s.values}
            dirtyKeys={s.dirtyKeys}
            disabled={readOnly}
            onChange={s.setField}
            shownBecauseFilled={visibility.NEXT_VISIT.shownBecauseFilled}
          />
        ) : null}

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
          shownBecauseFilled={visibility.DIAGNOSIS.shownBecauseFilled}
          refocusToken={s.addedTokens.diagnosis}
        />
        ) : null}

        {visibility.INVESTIGATIONS.visible ? (
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
          shownBecauseFilled={visibility.INVESTIGATIONS.shownBecauseFilled}
          refocusToken={s.addedTokens.investigation}
        />
        ) : null}

        {/*
          Prescribing is a separate screen, not a section — it has its own
          aggregate, its own version and its own conflicts (ADR 0011 §1).
        */}
        {readOnly ? null : <OpenPrescriptionButton encounterId={consultation.id} />}

        {/*
          Last, because it is the last thing that happens. Before this the
          encounter had no way to close from the consultation at all, and the
          patient's timeline said "Consultation in progress" indefinitely.
        */}
        {readOnly ? null : (
          <FinishConsultation
            encounterId={consultation.id}
            version={s.version}
            unsaved={s.anythingUnsaved}
          />
        )}
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
