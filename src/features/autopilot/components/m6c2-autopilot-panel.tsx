"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, CircleAlert, Loader2, Sparkles, Trash2 } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { generateAutopilotPrescriptionProposalAction } from "../server";
import { applyAutopilotProposalToDraftAction } from "../apply-server";
import { AUTOPILOT_REVIEW_LABEL, incompleteMedicineReason } from "../apply";
import type { AutopilotPrescription } from "../contracts";
import { proposalWithSelectedMedicines, selectionAfterMedicineRemoval } from "../m6e-voice-adapter";

export interface M6C2AutopilotVoiceHandle {
  hasProposal: () => boolean;
  target: () => string;
  generate: () => Promise<string>;
  read: () => string;
  next: () => string;
  previous: () => string;
  selectMedicine: (index: number) => string;
  deselectMedicine: (index: number) => string;
  editMedicine: (index: number) => string;
  removeMedicine: (index: number) => string;
  discard: () => string;
  apply: () => Promise<string>;
}

interface M6C2AutopilotPanelProps {
  encounterId: string;
  encounterVersion: number;
  prescriptionId: string;
  prescriptionVersion: number;
  disabled: boolean;
}

export const M6C2AutopilotPanel = React.forwardRef<M6C2AutopilotVoiceHandle, M6C2AutopilotPanelProps>(function M6C2AutopilotPanel({
  encounterId,
  encounterVersion,
  prescriptionId,
  prescriptionVersion,
  disabled,
}, voiceRef) {
  const router = useRouter();
  const [proposal, setProposal] = React.useState<AutopilotPrescription | null>(null);
  const [busy, setBusy] = React.useState<"generate" | "apply" | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [replaceFollowUp, setReplaceFollowUp] = React.useState(false);
  const [acknowledgeUncertainties, setAcknowledgeUncertainties] = React.useState(false);
  const [selectedMedicines, setSelectedMedicines] = React.useState<Set<number>>(() => new Set());
  const [voiceCursor, setVoiceCursor] = React.useState<number | null>(null);
  const busyRef = React.useRef<"generate" | "apply" | null>(null);
  const applyKeyRef = React.useRef<string | null>(null);

  async function generate(): Promise<string> {
    if (disabled || busyRef.current) return "Autopilot is currently unavailable. Nothing changed.";
    if (proposal) return "An Autopilot proposal is already open. Review, Apply, or Discard it first.";
    busyRef.current = "generate";
    setBusy("generate");
    setError(null);
    setMessage(null);
    const result = await generateAutopilotPrescriptionProposalAction({
      encounterId,
      expectedEncounterVersion: encounterVersion,
      prescriptionId,
      expectedPrescriptionVersion: prescriptionVersion,
    });
    setBusy(null);
    busyRef.current = null;
    if (!result.ok) {
      setProposal(null);
      setError(result.message);
      return result.message;
    }
    setProposal(result.proposal);
    setSelectedMedicines(new Set(result.proposal.medicines.map((_, index) => index)));
    setVoiceCursor(result.proposal.medicines.length > 0 ? 0 : null);
    applyKeyRef.current = crypto.randomUUID();
    return "Autopilot proposal generated. Review and edit it before explicit Apply selected.";
  }

  async function apply(): Promise<string> {
    if (!proposal) return "There is no Autopilot proposal to apply.";
    if (disabled || unresolved) return "Resolve incomplete or uncertain proposal items before Apply.";
    if (busyRef.current) return "Autopilot is already processing this request.";
    busyRef.current = "apply";
    setBusy("apply");
    setError(null);
    setMessage(null);
    const selectedProposal = proposalWithSelectedMedicines(proposal, selectedMedicines);
    const result = await applyAutopilotProposalToDraftAction({
      proposal: selectedProposal,
      applyKey: applyKeyRef.current ?? (applyKeyRef.current = crypto.randomUUID()),
      replaceFollowUp,
      acknowledgeUncertainties,
    });
    setBusy(null);
    busyRef.current = null;
    if (!result.ok) {
      setError(result.message);
      return result.message;
    }
    setProposal(null);
    setReplaceFollowUp(false);
    setAcknowledgeUncertainties(false);
    setSelectedMedicines(new Set());
    setVoiceCursor(null);
    setMessage(result.alreadyApplied ? "This proposal was already applied." : "Applied to the editable draft. Existing review is still required.");
    router.refresh();
    return result.alreadyApplied
      ? "This proposal was already applied; no duplicate write occurred."
      : "Selected proposal content was applied once to the editable draft. Prescription Review is still required.";
  }
  const unresolved = proposal ? (
    proposal.medicines.some((row, index) => selectedMedicines.has(index) && Boolean(incompleteMedicineReason(row))) ||
    proposal.investigations.some((row) => row.needsReview.length > 0 || !row.name) ||
    proposal.followUp.needsReview.length > 0 ||
    (proposal.uncertainties.length > 0 && !acknowledgeUncertainties)
  ) : false;

  function discard(): string {
    if (!proposal) return "There is no Autopilot proposal to discard.";
    if (busyRef.current) return "Autopilot is currently processing. Nothing changed.";
    setProposal(null);
    setError(null);
    setReplaceFollowUp(false);
    setAcknowledgeUncertainties(false);
    setSelectedMedicines(new Set());
    setVoiceCursor(null);
    applyKeyRef.current = null;
    return "Autopilot proposal discarded. No prescription draft content was written.";
  }

  function focusProposalMedicine(index: number): boolean {
    if (!proposal?.medicines[index]) return false;
    setVoiceCursor(index);
    window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-autopilot-medicine-index="${index}"]`);
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row?.querySelector<HTMLInputElement>("input[type='text']")?.focus();
    });
    return true;
  }

  function removeProposalMedicine(index: number): string {
    if (!proposal?.medicines[index]) return `Proposal medicine ${index + 1} does not exist. Nothing changed.`;
    setProposal({ ...proposal, medicines: proposal.medicines.filter((_, rowIndex) => rowIndex !== index) });
    setSelectedMedicines((current) => selectionAfterMedicineRemoval(current, index));
    setVoiceCursor(null);
    return `Proposal medicine ${index + 1} removed from the proposal only. Nothing was written to the prescription draft.`;
  }

  React.useImperativeHandle(voiceRef, () => ({
    hasProposal: () => proposal !== null,
    target: () => {
      document.querySelector<HTMLElement>("[data-m6c2-autopilot]")?.scrollIntoView({ block: "start", behavior: "smooth" });
      return proposal ? "Voice target is Prescription · Autopilot proposal." : "Voice target is Prescription · Autopilot.";
    },
    generate,
    read: () => proposal
      ? `Autopilot proposal has ${proposal.medicines.length} medicines, ${proposal.investigations.length} investigations, ${proposal.advice.length} advice items, ${proposal.warnings.length} warnings, and ${proposal.uncertainties.length} uncertainties.`
      : "There is no Autopilot proposal to read.",
    next: () => {
      if (!proposal?.medicines.length) return "There are no proposal medicines to navigate.";
      const next = (voiceCursor ?? -1) + 1;
      return focusProposalMedicine(next) ? `Proposal medicine ${next + 1} selected.` : "Already at the last proposal medicine.";
    },
    previous: () => {
      if (!proposal?.medicines.length) return "There are no proposal medicines to navigate.";
      const previous = (voiceCursor ?? proposal.medicines.length) - 1;
      return focusProposalMedicine(previous) ? `Proposal medicine ${previous + 1} selected.` : "Already at the first proposal medicine.";
    },
    selectMedicine: (index) => {
      const zeroIndex = index - 1;
      if (!proposal?.medicines[zeroIndex]) return `Proposal medicine ${index} does not exist. Nothing changed.`;
      setSelectedMedicines((current) => new Set(current).add(zeroIndex));
      focusProposalMedicine(zeroIndex);
      return `Proposal medicine ${index} selected for explicit Apply.`;
    },
    deselectMedicine: (index) => {
      const zeroIndex = index - 1;
      if (!proposal?.medicines[zeroIndex]) return `Proposal medicine ${index} does not exist. Nothing changed.`;
      setSelectedMedicines((current) => {
        const next = new Set(current);
        next.delete(zeroIndex);
        return next;
      });
      return `Proposal medicine ${index} deselected. It will not be applied.`;
    },
    editMedicine: (index) => focusProposalMedicine(index - 1)
      ? `Proposal medicine ${index} is focused for editing. Changes remain proposal-only until Apply.`
      : `Proposal medicine ${index} does not exist. Nothing changed.`,
    removeMedicine: (index) => removeProposalMedicine(index - 1),
    discard,
    apply,
  }));

  return (
    <SectionCard className="min-w-0 overflow-hidden" data-m6c2-autopilot data-ai-mode="mock">
      <SectionHeader
        title="Autopilot prescription"
        icon={<Bot className="size-4" />}
        action={<span className="text-[11px] text-ink-muted">Mock provider · doctor review required</span>}
      />
      <div className="min-w-0 space-y-4 p-4 sm:p-5">
        <p className="text-[12px] text-ink-secondary">{AUTOPILOT_REVIEW_LABEL}</p>
        {!proposal ? (
          <button type="button" onClick={() => void generate()} disabled={disabled || busy !== null}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white disabled:opacity-50">
            {busy === "generate" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate with Autopilot
          </button>
        ) : null}
        {error ? <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[12px] text-[#a81c1c]"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
        {message ? <p role="status" className="rounded-xl bg-surface-muted px-3 py-2 text-[12px] text-ink-secondary">{message}</p> : null}

        {proposal ? (
          <div className="min-w-0 space-y-4" data-m6c2-proposal-review>
            <ProposalMedicines
              proposal={proposal}
              selected={selectedMedicines}
              onSelectionChange={setSelectedMedicines}
              onChange={setProposal}
              onRemove={(index) => { removeProposalMedicine(index); }}
            />
            <ProposalInvestigations proposal={proposal} onChange={setProposal} />
            <ProposalAdvice proposal={proposal} onChange={setProposal} />
            <ProposalFollowUp proposal={proposal} onChange={setProposal} replaceFollowUp={replaceFollowUp} onReplaceFollowUp={setReplaceFollowUp} />

            {proposal.warnings.length > 0 ? <ReviewList title="Warnings" items={proposal.warnings} /> : null}
            {proposal.uncertainties.length > 0 ? <>
              <ReviewList title="Uncertainties / missing info" items={proposal.uncertainties} />
              <label className="flex min-h-11 items-center gap-2 text-[12px] text-ink-secondary"><input type="checkbox" checked={acknowledgeUncertainties} onChange={(e) => setAcknowledgeUncertainties(e.target.checked)} /> I reviewed these uncertainties / missing details.</label>
            </> : null}

            <div className="flex min-w-0 flex-wrap gap-2">
              <button type="button" onClick={() => void apply()} disabled={disabled || busy !== null || unresolved}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white disabled:opacity-50">
                {busy === "apply" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Apply to Draft
              </button>
              <button type="button" onClick={() => { discard(); }} disabled={busy !== null}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink disabled:opacity-50">
                <Trash2 className="size-4" /> Discard
              </button>
            </div>
            {unresolved ? <p role="status" className="text-[11px] font-medium text-warning">Resolve incomplete or uncertain proposal items before Apply.</p> : null}
            <p className="text-[10px] text-ink-muted">Apply changes editable draft state only. Existing M3 Review and explicit approval remain separate.</p>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
});
M6C2AutopilotPanel.displayName = "M6C2AutopilotPanel";

function ProposalMedicines({ proposal, selected, onSelectionChange, onChange, onRemove }: {
  proposal: AutopilotPrescription;
  selected: Set<number>;
  onSelectionChange: (value: Set<number>) => void;
  onChange: (value: AutopilotPrescription) => void;
  onRemove: (index: number) => void;
}) {
  const update = (index: number, patch: Partial<AutopilotPrescription["medicines"][number]>) => onChange({ ...proposal, medicines: proposal.medicines.map((row, i) => i === index ? { ...row, ...patch } : row) });
  return <ReviewSection title="Medicines">
    {proposal.medicines.length === 0 ? <Empty /> : proposal.medicines.map((row, index) => <div key={`${row.displayName ?? "medicine"}-${index}`} data-autopilot-medicine-index={index} className="min-w-0 rounded-xl border border-hairline p-3">
      <label className="mb-2 flex min-h-11 items-center gap-2 text-[12px] font-semibold text-ink-secondary">
        <input type="checkbox" checked={selected.has(index)} onChange={(event) => {
          const next = new Set(selected);
          if (event.target.checked) next.add(index); else next.delete(index);
          onSelectionChange(next);
        }} />
        Include medicine {index + 1} in Apply
      </label>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <Field label="Medicine" value={row.displayName ?? ""} onChange={(v) => update(index, { displayName: v || null })} />
        <Field label="Dose" value={row.doseText ?? ""} onChange={(v) => update(index, { doseText: v || null })} />
        <Field label="Dosage form" value={row.dosageForm ?? ""} onChange={(v) => update(index, { dosageForm: v || null })} />
        <Field label="Route" value={row.route ?? ""} onChange={(v) => update(index, { route: v || null })} />
        <Field label="Frequency / schedule" value={row.scheduleText ?? ""} onChange={(v) => update(index, { scheduleText: v || null })} />
        <Field label="Duration" value={row.durationText ?? ""} onChange={(v) => update(index, { durationText: v || null })} />
      </div>
      {row.needsReview.length > 0 ? <div className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-[11px] text-warning">
        {row.needsReview.map((item) => <p key={item}>{item}</p>)}
        <button type="button" onClick={() => update(index, { needsReview: [] })} className="mt-2 min-h-11 rounded-xl border border-hairline bg-white px-3 font-semibold text-ink">Mark medicine resolved</button>
      </div> : null}
      {incompleteMedicineReason(row) && row.needsReview.length === 0 ? <p className="mt-2 text-[11px] font-medium text-warning">{incompleteMedicineReason(row)}</p> : null}
      <button type="button" onClick={() => onRemove(index)} className="mt-2 min-h-11 rounded-xl px-3 text-[12px] font-semibold text-[#a81c1c]">Remove medicine</button>
    </div>)}
  </ReviewSection>;
}

function ProposalInvestigations({ proposal, onChange }: { proposal: AutopilotPrescription; onChange: (value: AutopilotPrescription) => void }) {
  const update = (index: number, patch: Partial<AutopilotPrescription["investigations"][number]>) => onChange({ ...proposal, investigations: proposal.investigations.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const remove = (index: number) => onChange({ ...proposal, investigations: proposal.investigations.filter((_, i) => i !== index) });
  return <ReviewSection title="Investigations">
    {proposal.investigations.length === 0 ? <Empty /> : proposal.investigations.map((row, index) => <div key={`${row.name ?? "investigation"}-${index}`} className="min-w-0 rounded-xl border border-hairline p-3">
      <Field label="Investigation" value={row.name ?? ""} onChange={(v) => update(index, { name: v || null })} />
      <Field label="Note" value={row.note ?? ""} onChange={(v) => update(index, { note: v || null })} />
      {row.needsReview.length > 0 ? <button type="button" onClick={() => update(index, { needsReview: [] })} className="mt-2 min-h-11 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink">Resolve investigation uncertainty</button> : null}
      <button type="button" onClick={() => remove(index)} className="mt-2 min-h-11 rounded-xl px-3 text-[12px] font-semibold text-[#a81c1c]">Remove investigation</button>
    </div>)}
  </ReviewSection>;
}
function ProposalAdvice({ proposal, onChange }: { proposal: AutopilotPrescription; onChange: (value: AutopilotPrescription) => void }) {
  const update = (index: number, value: string) => onChange({ ...proposal, advice: proposal.advice.map((row, i) => i === index ? { ...row, text: value || null } : row) });
  const remove = (index: number) => onChange({ ...proposal, advice: proposal.advice.filter((_, i) => i !== index) });
  return <ReviewSection title="Advice">
    {proposal.advice.length === 0 ? <Empty /> : proposal.advice.map((row, index) => <div key={index} className="min-w-0 rounded-xl border border-hairline p-3">
      <Field label="Advice" value={row.text ?? ""} onChange={(v) => update(index, v)} />
      <button type="button" onClick={() => remove(index)} className="mt-2 min-h-11 rounded-xl px-3 text-[12px] font-semibold text-[#a81c1c]">Remove advice</button>
    </div>)}
  </ReviewSection>;
}

function ProposalFollowUp({ proposal, onChange, replaceFollowUp, onReplaceFollowUp }: { proposal: AutopilotPrescription; onChange: (value: AutopilotPrescription) => void; replaceFollowUp: boolean; onReplaceFollowUp: (value: boolean) => void }) {
  const update = (patch: Partial<AutopilotPrescription["followUp"]>) => onChange({ ...proposal, followUp: { ...proposal.followUp, ...patch } });
  return <ReviewSection title="Follow-up">
    <div className="min-w-0 rounded-xl border border-hairline p-3">
      <Field label="Date (YYYY-MM-DD)" value={proposal.followUp.date ?? ""} onChange={(v) => update({ date: v || null })} />
      <Field label="Note" value={proposal.followUp.note ?? ""} onChange={(v) => update({ note: v || null })} />
      {proposal.followUp.needsReview.length > 0 ? <button type="button" onClick={() => update({ needsReview: [] })} className="mt-2 min-h-11 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink">Resolve follow-up uncertainty</button> : null}
      <label className="mt-2 flex min-h-11 items-center gap-2 text-[12px] text-ink-secondary"><input type="checkbox" checked={replaceFollowUp} onChange={(e) => onReplaceFollowUp(e.target.checked)} /> Explicitly replace a different existing doctor-authored follow-up if needed</label>
    </div>
  </ReviewSection>;
}
function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0 space-y-2"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">{title}</h3>{children}</section>;
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  return <ReviewSection title={title}><div className="min-w-0 rounded-xl bg-surface-muted px-3 py-2 text-[12px] text-ink-secondary">{items.map((item) => <p key={item} className="break-words">{item}</p>)}</div></ReviewSection>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block min-w-0 text-[11px] font-semibold text-ink-secondary">{label}<input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-hairline bg-white px-3 text-[14px] font-normal text-ink" /></label>;
}

function Empty() {
  return <p className="text-[12px] text-ink-muted">No proposed items.</p>;
}
