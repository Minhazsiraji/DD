"use client";

import * as React from "react";
import { Mic2 } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import type { DraftKey, DraftValues, SectionKey } from "../schema";
import { M6ADictationReview } from "@/features/dictation/components/m6a-dictation-review";

const TARGETS: readonly { key: SectionKey; label: string }[] = [
  { key: "chiefComplaints", label: "Chief complaint" },
  { key: "presentIllness", label: "History" },
  { key: "examination", label: "Examination" },
  { key: "assessment", label: "Assessment" },
  { key: "advice", label: "Advice" },
  { key: "nextVisitNote", label: "Follow-up" },
];

export function M6AVoicePanel({
  values,
  disabled,
  onChange,
}: {
  values: DraftValues;
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
}) {
  const [target, setTarget] = React.useState<SectionKey>("chiefComplaints");
  const selected = TARGETS.find((item) => item.key === target) ?? TARGETS[0]!;

  return (
    <SectionCard className="overflow-hidden" data-m6a-voice-panel>
      <SectionHeader
        title="Voice clinical notes"
        icon={<Mic2 className="size-4" />}
        action={<span className="text-[11px] text-ink-muted">Review required before clinical write</span>}
      />
      <div className="p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="m6a-target" className="text-[12px] font-semibold text-ink-secondary">
            Dictate into
          </label>
          <select
            id="m6a-target"
            value={target}
            disabled={disabled}
            onChange={(event) => setTarget(event.target.value as SectionKey)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-hairline bg-white px-3 text-[14px] font-semibold text-ink focus-visible:focus-ring disabled:bg-surface-muted disabled:text-ink-secondary sm:max-w-xs"
          >
            {TARGETS.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </div>

        <M6ADictationReview
          key={target}
          fieldLabel={selected.label}
          value={values[target]}
          disabled={disabled}
          onAccept={(next) => onChange(target, next)}
        />
      </div>
    </SectionCard>
  );
}
