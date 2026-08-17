"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { ConsultationIdentity } from "./consultation-identity";
import { SectionFields, VitalFields } from "./draft-fields";
import { ConflictPanel } from "./conflict-panel";
import { SaveBar } from "./save-bar";
import { UnsavedGuard } from "./unsaved-guard";
import { useDraft } from "../use-draft";
import type { Consultation } from "../queries";

/**
 * The consultation screen.
 *
 * Read-only once the encounter leaves DRAFT — completed records are corrected
 * through Stage 9's amendment path, never by editing in place, so the editor
 * must not pretend otherwise.
 */
export function ConsultationWorkspace({
  consultation,
  locationName,
}: {
  consultation: Consultation;
  locationName: string;
}) {
  const draft = useDraft(consultation.id, consultation.values, consultation.version);
  const readOnly = consultation.status !== "DRAFT";
  const conflict = draft.state.kind === "conflict" ? draft.state : null;

  return (
    <div className="pb-2">
      {/*
        Covers reload, every internal link in the shell, and Back/Forward.
        beforeunload alone would have let a sidebar tap discard typed notes
        without a word.
      */}
      <UnsavedGuard dirty={draft.isDirty && !readOnly} />
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
            mine={draft.values}
            theirs={conflict.theirs}
            unsavedKeys={draft.dirtyKeys}
            onKeepMine={draft.keepMine}
            onTakeTheirs={draft.takeTheirs}
          />
        </div>
      ) : null}

      <div className="space-y-4">
        <VitalFields
          values={draft.values}
          dirtyKeys={draft.dirtyKeys}
          errors={draft.vitalErrors}
          disabled={readOnly}
          onChange={draft.setField}
        />
        <SectionFields
          values={draft.values}
          dirtyKeys={draft.dirtyKeys}
          disabled={readOnly}
          onChange={draft.setField}
        />
      </div>

      {readOnly ? null : (
        <SaveBar
          state={draft.state}
          dirtyCount={draft.dirtyKeys.length}
          disabled={
            draft.state.kind === "saving" ||
            !draft.isDirty ||
            draft.hasVitalErrors ||
            conflict !== null
          }
          onSave={draft.save}
        />
      )}
    </div>
  );
}
