"use client";

import * as React from "react";
import { Check, CircleAlert, Command, Loader2, Mic, ShieldAlert, Square, Trash2 } from "lucide-react";
import { createMockVoiceTranscriptionProvider } from "../mock-provider";
import { parseM6BCommand, type M6BIntent, type M6BNavigationTarget } from "../m6b-command-parser";
import { useDictation } from "../use-dictation";
import { LIVE_VOICE_ENABLED, useVoiceLanguage, VoiceLanguageControl } from "../voice-language";

type MockScenario = "navigation" | "medicine" | "investigation" | "follow-up" | "finalize";
const M6D_CLINICAL_EVENT = "dd:m6d-clinical-command";

function fixture(lang: string, scenario: MockScenario): string {
  const bn = lang === "bn-BD";
  const mixed = lang === "bn-BD-mixed";
  if (scenario === "medicine") return bn ? "Napa 500 mg add করো" : mixed ? "Napa 500 mg add করো" : "Add Napa 500 mg";
  if (scenario === "investigation") return bn ? "CBC আর creatinine add করো" : mixed ? "CBC আর creatinine add করো" : "Add CBC and serum creatinine";
  if (scenario === "follow-up") return bn ? "ফলো আপ সাত দিন" : mixed ? "follow up সাত দিন" : "follow-up seven days";
  if (scenario === "finalize") return bn ? "প্রেসক্রিপশন ফাইনাল করো" : mixed ? "prescription final করো" : "finalize prescription";
  return bn ? "পরীক্ষা অংশে যাও" : mixed ? "examination এ যাও" : "go to examination";
}

function proposalTitle(intent: M6BIntent): string {
  if (intent.type === "PROPOSE_MEDICINE") return "Medicine proposal";
  if (intent.type === "PROPOSE_INVESTIGATION") return "Investigation proposal";
  if (intent.type === "PROPOSE_FOLLOW_UP") return "Follow-up proposal";
  if (intent.type === "PROHIBITED_ACTION") return "Protected command";
  return "Voice command";
}

async function normalizeLiveTranscript(transcript: string, language: string): Promise<string> {
  if (!LIVE_VOICE_ENABLED || language !== "bn-BD-mixed") return transcript;
  const response = await fetch("/api/voice/normalize", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ transcript, language }),
  });
  const payload = (await response.json().catch(() => ({}))) as { transcript?: string };
  return response.ok && payload.transcript ? payload.transcript : transcript;
}

async function interpretLiveCommand(transcript: string, language: string): Promise<M6BIntent> {
  const response = await fetch("/api/voice/command", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ transcript, language }),
  });
  const payload = (await response.json().catch(() => ({}))) as { intent?: M6BIntent; code?: string };
  if (!response.ok || !payload.intent) throw new Error(payload.code ?? "openai-command-unavailable");
  return payload.intent;
}

export function M6BVoiceCommands({
  disabled,
  onNavigate,
  onApplyMedicine,
  onApplyInvestigations,
  onApplyFollowUp,
}: {
  disabled: boolean;
  onNavigate: (target: M6BNavigationTarget) => void | Promise<void>;
  onApplyMedicine: (intent: Extract<M6BIntent, { type: "PROPOSE_MEDICINE" }>) => void | Promise<void>;
  onApplyInvestigations: (names: string[]) => void;
  onApplyFollowUp: (days: number) => void;
}) {
  const language = useVoiceLanguage();
  const [scenario, setScenario] = React.useState<MockScenario>("navigation");
  const [transcript, setTranscript] = React.useState("");
  const [intent, setIntent] = React.useState<M6BIntent | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [interpreting, setInterpreting] = React.useState(false);
  const [fromContinuousVoice, setFromContinuousVoice] = React.useState(false);

  const provider = React.useMemo(
    () => createMockVoiceTranscriptionProvider({ transcript: fixture(language.lang, scenario) }),
    [language.lang, scenario],
  );

  const handleParsed = React.useCallback(async (text: string) => {
    setMessage(null);
    let commandText = text;
    let parsed: M6BIntent;

    if (LIVE_VOICE_ENABLED) {
      setInterpreting(true);
      try {
        commandText = await normalizeLiveTranscript(text, language.lang);
        setTranscript(commandText);
        parsed = await interpretLiveCommand(commandText, language.lang);
      } catch {
        setIntent(null);
        setTranscript(commandText);
        setMessage("OpenAI command understanding is unavailable. Nothing was changed.");
        setInterpreting(false);
        return;
      }
      setInterpreting(false);
    } else {
      setTranscript(commandText);
      parsed = parseM6BCommand(commandText);
    }

    if (parsed.type === "NAVIGATE") {
      setIntent(null);
      setMessage(`Recognized navigation: ${parsed.target.replaceAll("-", " ")}.`);
      void onNavigate(parsed.target);
      return;
    }
    if (parsed.type === "PROHIBITED_ACTION" && parsed.action === "FINALIZE_PRESCRIPTION" && parsed.reviewOnly) {
      setIntent(parsed);
      setMessage("Voice cannot finalize. This command can only open the existing Review/Finalize screen.");
      return;
    }
    if (parsed.type === "UNKNOWN") {
      setIntent(parsed);
      setMessage("Command not recognized. Nothing was changed.");
      return;
    }
    setIntent(parsed);
    setMessage(null);
  }, [language.lang, onNavigate]);

  const dictation = useDictation({
    language:
      language.lang === "bn-BD-mixed" && !LIVE_VOICE_ENABLED
        ? "mixed"
        : language.providerLanguage,
    providerMode: LIVE_VOICE_ENABLED ? "deepgram" : "mock",
    providerOverride: LIVE_VOICE_ENABLED ? undefined : provider,
    onPreview: setTranscript,
    onFinal: (text) => void handleParsed(text),
    onCancel: () => setTranscript(""),
  });

  const dictating = ["connecting", "listening", "finalizing"].includes(dictation.state);
  const active = dictating || interpreting;

  React.useEffect(() => {
    function receive(event: Event) {
      const detail = (event as CustomEvent<{ text?: unknown }>).detail;
      if (!detail || typeof detail.text !== "string" || !detail.text.trim()) return;
      setFromContinuousVoice(true);
      void handleParsed(detail.text);
      requestAnimationFrame(() => {
        document.querySelector("[data-m6b-command-review]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    window.addEventListener(M6D_CLINICAL_EVENT, receive);
    return () => window.removeEventListener(M6D_CLINICAL_EVENT, receive);
  }, [handleParsed]);

  function reset() {
    dictation.cancel();
    dictation.reset();
    setTranscript("");
    setIntent(null);
    setMessage(null);
    setInterpreting(false);
    setFromContinuousVoice(false);
  }

  function editTranscript(value: string) {
    setTranscript(value);
    setIntent(parseM6BCommand(value));
    setMessage(null);
  }

  async function apply() {
    if (!intent) return;
    if (intent.type === "PROPOSE_MEDICINE") await onApplyMedicine(intent);
    else if (intent.type === "PROPOSE_INVESTIGATION") onApplyInvestigations(intent.investigations);
    else if (intent.type === "PROPOSE_FOLLOW_UP" && intent.days !== null) onApplyFollowUp(intent.days);
    else if (intent.type === "PROHIBITED_ACTION" && intent.action === "FINALIZE_PRESCRIPTION" && intent.reviewOnly) await onNavigate("prescription-review");
    else return;
    setMessage("Applied through the existing Doctor's Diary workflow.");
    setIntent(null);
    setTranscript("");
    setFromContinuousVoice(false);
    dictation.reset();
  }

  const canApply = intent && (
    intent.type === "PROPOSE_MEDICINE" ||
    (intent.type === "PROPOSE_INVESTIGATION" && intent.investigations.length > 0) ||
    (intent.type === "PROPOSE_FOLLOW_UP" && intent.days !== null) ||
    (intent.type === "PROHIBITED_ACTION" && intent.action === "FINALIZE_PRESCRIPTION" && intent.reviewOnly)
  );

  return (
    <section data-m6b-voice-commands data-voice-mode={LIVE_VOICE_ENABLED ? "live-ai" : "mock"} className="dd-app-panel min-w-0 rounded-glass p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><Command className="size-4 text-brand" aria-hidden="true" /><h2 className="text-[15px] font-semibold text-ink">Voice clinical actions</h2></div>
          <p className="mt-1 text-[11px] text-ink-muted">Deepgram transcribes speech; OpenAI restores mixed-script Banglish where needed and interprets allowlisted commands. Clinical actions still require review and explicit Apply.</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-[10px] font-semibold text-ink-secondary">{LIVE_VOICE_ENABLED ? "M6D live pilot" : "M6D mock"}</span>
      </div>

      {fromContinuousVoice ? <p className="mt-2 rounded-xl bg-brand/5 px-3 py-2 text-[11px] font-medium text-brand">Prepared by the continuous Voice Assistant. Review/edit below before Apply.</p> : null}

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        <VoiceLanguageControl disabled={disabled || active || intent !== null} />
        {LIVE_VOICE_ENABLED ? <span className="text-[11px] font-semibold text-ink-muted">Deepgram STT → OpenAI language/command understanding</span> : null}
        {!LIVE_VOICE_ENABLED ? (
          <label className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-hairline bg-white px-3 text-[12px] text-ink-secondary">
            <span className="shrink-0 font-medium">Mock command</span>
            <select aria-label="M6B mock command" value={scenario} disabled={disabled || active || intent !== null} onChange={(e) => setScenario(e.target.value as MockScenario)} className="min-w-0 max-w-40 bg-transparent font-semibold text-ink outline-none">
              <option value="navigation">Navigation</option><option value="medicine">Medicine</option><option value="investigation">Investigation</option><option value="follow-up">Follow-up</option><option value="finalize">Finalize guard</option>
            </select>
          </label>
        ) : null}
        {interpreting ? <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink-secondary"><Loader2 className="size-4 animate-spin" /> Understanding language and command…</span> : dictating ? <button type="button" onClick={dictation.stop} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#a81c1c] px-3 text-[12px] font-semibold text-white"><Square className="size-3.5 fill-current" /> Stop</button> : intent ? null : <button type="button" disabled={disabled} onClick={dictation.start} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><Mic className="size-4" /> Command</button>}
        {(active || intent) ? <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><Trash2 className="size-4" /> Discard</button> : null}
      </div>

      {dictating && transcript ? <p role="status" className="mt-2 break-words text-[12px] text-ink-secondary"><strong>Live command:</strong> {transcript}</p> : null}
      {dictation.error ? <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12px] font-medium text-[#a81c1c]"><CircleAlert className="mt-0.5 size-4 shrink-0" />{dictation.error}</p> : null}

      {intent ? <div className="mt-3 min-w-0 rounded-xl border border-brand/25 bg-white p-3" data-m6b-command-review>
        <div className="flex items-center gap-2"><h3 className="text-[12px] font-semibold uppercase tracking-wide text-brand">{proposalTitle(intent)}</h3>{intent.type === "PROHIBITED_ACTION" ? <ShieldAlert className="size-4 text-warning" /> : null}</div>
        <label className="mt-2 block text-[12px] font-semibold text-ink" htmlFor="m6b-command-transcript">Review/edit command transcript</label>
        <textarea id="m6b-command-transcript" rows={2} value={transcript} onChange={(e) => editTranscript(e.target.value)} className="mt-1 w-full resize-y rounded-xl border border-hairline bg-white px-3 py-2.5 text-[15px] leading-relaxed text-ink" />
        <ProposalSummary intent={intent} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void apply()} disabled={!canApply} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-[12px] font-semibold text-white disabled:opacity-50"><Check className="size-4" />{intent.type === "PROHIBITED_ACTION" ? "Open Review only" : "Apply"}</button>
          <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[12px] font-semibold text-ink"><Trash2 className="size-4" />Discard</button>
        </div>
      </div> : null}

      {message ? <p role="status" className="mt-2 text-[12px] font-medium text-ink-secondary">{message}</p> : null}
      <p className="mt-2 text-[10px] text-ink-muted">Clinical actions remain proposal-based. Neither continuous Voice nor OpenAI may bypass Apply or the existing M3 final confirmation.</p>
    </section>
  );
}

function ProposalSummary({ intent }: { intent: M6BIntent }) {
  if (intent.type === "PROPOSE_MEDICINE") return <div className="mt-2 text-[12px] text-ink-secondary"><p><strong>Medicine:</strong> {intent.medicine.name || "Unclear"}{intent.medicine.strengthText ? ` · ${intent.medicine.strengthText}` : ""}</p>{intent.uncertainties.map((u) => <p key={u} className="mt-1 text-warning">Needs review: {u}</p>)}</div>;
  if (intent.type === "PROPOSE_INVESTIGATION") return <p className="mt-2 text-[12px] text-ink-secondary"><strong>Stage:</strong> {intent.investigations.join(", ")}</p>;
  if (intent.type === "PROPOSE_FOLLOW_UP") return <div className="mt-2 text-[12px] text-ink-secondary"><p><strong>Follow-up:</strong> {intent.days === null ? "Interval unclear" : `${intent.days} days`}</p>{intent.uncertainties.map((u) => <p key={u} className="mt-1 text-warning">Needs review: {u}</p>)}</div>;
  if (intent.type === "PROHIBITED_ACTION") return <p className="mt-2 text-[12px] text-warning">Voice execution is prohibited. Finalize can only open the existing Review/Finalize UI; the existing M3 confirmation remains mandatory.</p>;
  if (intent.type === "UNKNOWN") return <p className="mt-2 text-[12px] text-warning">Unknown command. Apply is disabled and nothing will change.</p>;
  return null;
}
