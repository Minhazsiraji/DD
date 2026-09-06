"use client";

import * as React from "react";
import { MessageSquareText } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { cn } from "@/lib/utils";
import { MODULE_BY_DRAFT_KEY, type VisibilityMap } from "../module-visibility";
import type { DraftKey, DraftValues, SectionKey } from "../schema";
import type { PreviousVisit } from "../previous-visit";
import {
  COMMON_COMPLAINT_SUGGESTIONS,
  COMMON_SYMPTOM_SUGGESTIONS,
  appendTextSuggestion,
} from "../text-suggestions";

/**
 * M2's current-visit editor.
 *
 * This is deliberately one clinical panel rather than one large glass card per
 * textarea. Every value still writes to the SAME accepted encounter draft key;
 * the redesign changes reachability and typing effort, never persistence.
 */
export function M2ClinicalNotes({
  values,
  dirtyKeys,
  disabled,
  onChange,
  visibility,
  previousVisit,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  visibility: VisibilityMap;
  previousVisit: PreviousVisit | null;
}) {
  const visible = React.useCallback(
    (key: DraftKey) => {
      const owner = MODULE_BY_DRAFT_KEY.get(key);
      return owner ? visibility[owner].visible : true;
    },
    [visibility],
  );

  const becauseFilled = React.useCallback(
    (key: DraftKey) => {
      const owner = MODULE_BY_DRAFT_KEY.get(key);
      return owner ? visibility[owner].shownBecauseFilled : false;
    },
    [visibility],
  );

  const historyOpen =
    values.pastHistory.trim() !== "" ||
    dirtyKeys.includes("pastHistory") ||
    becauseFilled("pastHistory");

  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Current visit"
        icon={<MessageSquareText className="size-4" />}
        action={<span className="text-[11px] text-ink-muted">Autosaves as you work</span>}
      />

      <div className="space-y-5 p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-2">
          {visible("chiefComplaints") ? (
            <ClinicalTextarea
              field="chiefComplaints"
              label="Chief complaints"
              placeholder="What brought them in, in their words"
              rows={3}
              value={values.chiefComplaints}
              dirty={dirtyKeys.includes("chiefComplaints")}
              disabled={disabled}
              shownBecauseFilled={becauseFilled("chiefComplaints")}
              onChange={onChange}
            >
              <SuggestionRow
                label="Quick add"
                suggestions={COMMON_COMPLAINT_SUGGESTIONS}
                current={values.chiefComplaints}
                disabled={disabled}
                onPick={(term) =>
                  onChange(
                    "chiefComplaints",
                    appendTextSuggestion(values.chiefComplaints, term),
                  )
                }
              />
              {previousVisit?.chiefComplaints ? (
                <PreviousTextSuggestion
                  label="Use previous complaint"
                  value={previousVisit.chiefComplaints}
                  disabled={disabled}
                  onUse={() => onChange("chiefComplaints", previousVisit.chiefComplaints!)}
                />
              ) : null}
            </ClinicalTextarea>
          ) : null}

          {visible("symptoms") ? (
            <ClinicalTextarea
              field="symptoms"
              label="Symptoms"
              placeholder="Fever, cough, pain — as the patient reports them"
              rows={3}
              value={values.symptoms}
              dirty={dirtyKeys.includes("symptoms")}
              disabled={disabled}
              shownBecauseFilled={becauseFilled("symptoms")}
              onChange={onChange}
            >
              <SuggestionRow
                label="Quick add"
                suggestions={COMMON_SYMPTOM_SUGGESTIONS}
                current={values.symptoms}
                disabled={disabled}
                onPick={(term) =>
                  onChange("symptoms", appendTextSuggestion(values.symptoms, term))
                }
              />
            </ClinicalTextarea>
          ) : null}
        </div>

        {visible("presentIllness") ? (
          <ClinicalTextarea
            field="presentIllness"
            label="History of present illness"
            placeholder="Onset, duration, course, associated symptoms"
            rows={4}
            value={values.presentIllness}
            dirty={dirtyKeys.includes("presentIllness")}
            disabled={disabled}
            shownBecauseFilled={becauseFilled("presentIllness")}
            onChange={onChange}
          />
        ) : null}

        {visible("pastHistory") ? (
          <details
            className="dd-material-record dd-record-pearl rounded-2xl"
            open={historyOpen || undefined}
          >
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-semibold text-ink focus-visible:focus-ring">
              Past history
              {dirtyKeys.includes("pastHistory") ? (
                <span className="ml-auto rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-warning">
                  Pending
                </span>
              ) : (
                <span className="ml-auto text-[11px] font-normal text-ink-muted">Optional</span>
              )}
            </summary>
            <div className="border-t border-white/45 p-3">
              {becauseFilled("pastHistory") ? <FilledNotice /> : null}
              <label htmlFor="pastHistory" className="sr-only">Past history</label>
              <textarea
                id="pastHistory"
                name="pastHistory"
                rows={3}
                disabled={disabled}
                value={values.pastHistory}
                onChange={(e) => onChange("pastHistory", e.target.value)}
                placeholder="Previous illness, surgery, family and personal history"
                spellCheck={false}
                className="w-full resize-y rounded-xl border border-hairline bg-white/88 px-3 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
              />
              {previousVisit?.pastHistory && values.pastHistory === "" ? (
                <PreviousTextSuggestion
                  label="Use previous history"
                  value={previousVisit.pastHistory}
                  disabled={disabled}
                  onUse={() => onChange("pastHistory", previousVisit.pastHistory!)}
                />
              ) : null}
            </div>
          </details>
        ) : null}

        {visible("examination") ? (
          <ClinicalTextarea
            field="examination"
            label="Examination"
            placeholder="General and systemic findings"
            rows={4}
            value={values.examination}
            dirty={dirtyKeys.includes("examination")}
            disabled={disabled}
            shownBecauseFilled={becauseFilled("examination")}
            onChange={onChange}
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {visible("assessment") ? (
            <ClinicalTextarea
              field="assessment"
              label="Assessment"
              placeholder="Working impression"
              rows={3}
              value={values.assessment}
              dirty={dirtyKeys.includes("assessment")}
              disabled={disabled}
              shownBecauseFilled={becauseFilled("assessment")}
              onChange={onChange}
            />
          ) : null}
          {visible("advice") ? (
            <ClinicalTextarea
              field="advice"
              label="Advice"
              placeholder="Instructions and red flags to return for"
              rows={3}
              value={values.advice}
              dirty={dirtyKeys.includes("advice")}
              disabled={disabled}
              shownBecauseFilled={becauseFilled("advice")}
              onChange={onChange}
            />
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

function ClinicalTextarea({
  field,
  label,
  placeholder,
  rows,
  value,
  dirty,
  disabled,
  shownBecauseFilled,
  onChange,
  children,
}: {
  field: SectionKey;
  label: string;
  placeholder: string;
  rows: number;
  value: string;
  dirty: boolean;
  disabled: boolean;
  shownBecauseFilled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-h-5 items-center gap-2">
        <label htmlFor={field} className="text-[13px] font-semibold text-ink">{label}</label>
        {dirty ? (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning">
            Pending
          </span>
        ) : null}
      </div>
      {shownBecauseFilled ? <FilledNotice /> : null}
      <textarea
        id={field}
        name={field}
        rows={rows}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          "w-full resize-y rounded-xl border bg-white/88 px-3 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted disabled:text-ink-secondary",
          dirty ? "border-warning/70" : "border-hairline",
        )}
      />
      {children}
    </div>
  );
}

function SuggestionRow({
  label,
  suggestions,
  current,
  disabled,
  onPick,
}: {
  label: string;
  suggestions: readonly string[];
  current: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div className="mt-2">
      <p className="text-[11px] text-ink-muted">{label} · suggestions do nothing until selected</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => {
          const already = current.toLocaleLowerCase().includes(suggestion.toLocaleLowerCase());
          return (
            <button
              key={suggestion}
              type="button"
              disabled={disabled || already}
              onClick={() => onPick(suggestion)}
              className="dd-secondary inline-flex min-h-11 items-center px-3 text-[12px] font-semibold disabled:opacity-45 focus-visible:focus-ring"
            >
              {suggestion}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreviousTextSuggestion({
  label,
  value,
  disabled,
  onUse,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onUse: () => void;
}) {
  const preview = value.replace(/\s+/g, " ").trim();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
      <span className="max-w-full truncate">Previous: {preview}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onUse}
        className="inline-flex min-h-11 items-center rounded-xl px-2.5 font-semibold text-brand hover:bg-white/35 disabled:opacity-45 focus-visible:focus-ring"
      >
        {label}
      </button>
    </div>
  );
}

function FilledNotice() {
  return (
    <p className="mb-1.5 text-[11px] text-ink-muted">
      Shown because this visit already contains information.
    </p>
  );
}
