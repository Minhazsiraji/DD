"use client";

import * as React from "react";
import { Mic2, Pause, Play, ShieldAlert, Square, Undo2, Waves } from "lucide-react";
import type { DraftKey, DraftValues } from "../schema";
import type { FindingDraft } from "../finding-types";
import { insertTranscript } from "@/features/dictation/dictation";
import { useDictation } from "@/features/dictation/use-dictation";
import { LIVE_VOICE_ENABLED, useVoiceLanguage, VoiceLanguageControl } from "@/features/dictation/voice-language";
import { isM6DCommandLikeUtterance, isM6DDiagnosisIntent, isM6DInvestigationIntent, isM6DNavigationIntent, m6dNavigationCommandKey, parseM6DAppendText, parseM6DLocalCommand, type M6DDiagnosisIntent, type M6DInvestigationIntent, type M6DLocalIntent, type M6DNavigationIntent, type M6DTarget } from "@/features/dictation/m6d-intent-router";
import { applyM6DTextEdit, INITIAL_M6D_VOICE_STATE, M6D_VOICE_SECTION_OPTIONS, m6dCommandPriority, m6dVoiceDestinationForIntent, m6dVoiceDestinationForSection, m6dVoiceFocusSelector, m6dVoiceSection, type M6DPendingNavigation, type M6DVoiceDestination, type M6DVoiceSection, type M6DVoiceState } from "@/features/dictation/m6d-voice-state";
import { parseM6BCommand, type M6BIntent } from "@/features/dictation/m6b-command-parser";
import { SectionCard } from "@/components/common/section-card";

const LABELS: Record<M6DTarget, string> = {
  chiefComplaints: "Chief complaint",
  presentIllness: "History",
  examination: "Examination",
  assessment: "Assessment",
  advice: "Advice",
  nextVisitNote: "Follow-up",
};
const SECTION_LABELS: Record<M6DVoiceSection, string> = { ...LABELS, diagnoses: "Diagnoses", investigations: "Investigation orders" };
const M6D_CLINICAL_EVENT = "dd:m6d-clinical-command";
const SILENCE_FINALIZE_MS = 800;
const FAST_NAVIGATION_STABLE_MS = 80;
const VOICE_RESTART_DELAY_MS = 100;

type LastVoiceChange =
  | { kind: "note"; target: M6DTarget; before: string; after: string }
  | { kind: "diagnosis"; target: "title" | "note"; before: string; after: string }
  | { kind: "investigation"; before: string; after: string };

async function normalizeTranscript(transcript: string, language: string) {
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

async function interpretCommand(transcript: string, language: string): Promise<M6BIntent | null> {
  if (!LIVE_VOICE_ENABLED) return null;
  const response = await fetch("/api/voice/command", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ transcript, language }),
  });
  const payload = (await response.json().catch(() => ({}))) as { intent?: M6BIntent };
  return response.ok && payload.intent ? payload.intent : null;
}

function navigationSection(intent: M6BIntent): M6DTarget | null {
  if (intent.type !== "NAVIGATE") return null;
  const map: Partial<Record<typeof intent.target, M6DTarget>> = {
    "chief-complaint": "chiefComplaints",
    history: "presentIllness",
    examination: "examination",
    assessment: "assessment",
    advice: "advice",
    "follow-up": "nextVisitNote",
  };
  return map[intent.target] ?? null;
}

function isM6DDiagnosisDirectOpenIntent(intent: M6DLocalIntent): boolean {
  return intent.type === "DIAGNOSIS_NAVIGATE" ||
    (intent.type === "DIAGNOSIS_TARGET" && intent.target === "title");
}

export function M6AVoicePanel({
  values,
  diagnosisDraft,
  disabled,
  onChange,
  onOpenDiagnosis,
  onDiagnosisDraftChange,
  onFocusInvestigation,
  onAppendInvestigation,
  onEditInvestigation,
}: {
  values: DraftValues;
  diagnosisDraft: FindingDraft | null;
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  onOpenDiagnosis: () => void;
  onDiagnosisDraftChange: (draft: FindingDraft) => void;
  onFocusInvestigation: () => void;
  onAppendInvestigation: (text: string) => { before: string; after: string } | null;
  onEditInvestigation: (intent: M6DLocalIntent, undo: { before: string; after: string } | null) => { handled: boolean; mutation: { before: string; after: string } | null; message: string };
}) {
  const voiceLanguage = useVoiceLanguage();
  const [voiceState, setVoiceState] = React.useState<M6DVoiceState>(INITIAL_M6D_VOICE_STATE);
  const [mode, setMode] = React.useState<"guided" | "ambient">("guided");
  const [preview, setPreview] = React.useState("");
  const [status, setStatus] = React.useState("Ready. Start Voice once, then speak naturally or use short commands.");
  const [ambientDraft, setAmbientDraft] = React.useState("");
  const [lastChange, setLastChangeState] = React.useState<LastVoiceChange | null>(null);
  const voiceStateRef = React.useRef<M6DVoiceState>(INITIAL_M6D_VOICE_STATE);
  const lastChangeRef = React.useRef<LastVoiceChange | null>(null);
  const valuesRef = React.useRef(values);
  const startRef = React.useRef<(() => void) | null>(null);
  const stopRef = React.useRef<(() => void) | null>(null);
  const silenceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fastNavigationTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPreviewRef = React.useRef("");
  const diagnosisDraftRef = React.useRef<FindingDraft | null>(diagnosisDraft);
  const pendingDiagnosisIntentRef = React.useRef<M6DDiagnosisIntent | null>(null);
  const pendingReplaceLastRef = React.useRef<M6DVoiceDestination | null>(null);
  const applyDiagnosisIntentRef = React.useRef<(intent: M6DDiagnosisIntent) => void>(() => undefined);
  const stickyShellRef = React.useRef<HTMLDivElement>(null);

  const sessionActive = voiceState.session !== "idle";
  const paused = voiceState.session === "paused";
  const currentSection = m6dVoiceSection(voiceState.destination);
  React.useEffect(() => { valuesRef.current = values; }, [values]);
  React.useEffect(() => () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (fastNavigationTimer.current) clearTimeout(fastNavigationTimer.current);
  }, []);
  React.useLayoutEffect(() => {
    const shell = stickyShellRef.current;
    const workspace = shell?.closest<HTMLElement>("[data-consultation-workspace]");
    if (!shell || !workspace) return;

    const updateOffset = () => {
      const height = Math.ceil(shell.getBoundingClientRect().height);
      workspace.style.setProperty("--m6d-voice-sticky-offset", `${height + 20}px`);
    };
    updateOffset();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateOffset);
    observer?.observe(shell);
    window.addEventListener("resize", updateOffset);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateOffset);
      workspace.style.removeProperty("--m6d-voice-sticky-offset");
    };
  }, []);

  function clearSilenceTimer() {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  }

  function commitVoiceState(update: (current: M6DVoiceState) => M6DVoiceState) {
    const next = update(voiceStateRef.current);
    voiceStateRef.current = next;
    setVoiceState(next);
  }

  function recordChange(change: LastVoiceChange | null) {
    lastChangeRef.current = change;
    setLastChangeState(change);
  }

  function setDestination(destination: M6DVoiceDestination, message?: string) {
    pendingReplaceLastRef.current = null;
    commitVoiceState((current) => ({ ...current, destination }));
    if (message) setStatus(message);
  }

  function rollbackPendingNavigation() {
    const pending = voiceStateRef.current.pendingNavigation;
    if (!pending || pending.consumed) return;
    commitVoiceState((current) => ({ ...current, destination: pending.previousDestination, pendingNavigation: null }));
  }

  function routePendingNavigation(intent: M6DNavigationIntent, consumed: boolean) {
    const key = m6dNavigationCommandKey(intent);
    const existing = voiceStateRef.current.pendingNavigation;
    if (existing?.key === key) {
      commitVoiceState((current) => ({ ...current, pendingNavigation: current.pendingNavigation ? { ...current.pendingNavigation, consumed: current.pendingNavigation.consumed || consumed } : null }));
      return;
    }
    if (existing && !existing.consumed) rollbackPendingNavigation();
    const previousDestination = voiceStateRef.current.destination;
    const destination = m6dVoiceDestinationForIntent(previousDestination, intent);
    if (!destination || destination.kind !== "note") return;
    const pending: M6DPendingNavigation = { key, target: destination.target, previousDestination, consumed };
    commitVoiceState((current) => ({ ...current, destination, pendingNavigation: pending }));
    focusDestination(destination);
    setStatus(`Current target: ${LABELS[destination.target]}.`);
  }

  function previewWithSilenceFinalization(text: string) {
    setPreview(text);
    latestPreviewRef.current = text;
    clearSilenceTimer();
    if (fastNavigationTimer.current) clearTimeout(fastNavigationTimer.current);
    fastNavigationTimer.current = null;
    if (!text.trim()) return;

    if (mode === "guided") {
      const candidate = parseM6DLocalCommand(text);
      const pending = voiceStateRef.current.pendingNavigation;
      if (pending && !pending.consumed) {
        if (!isM6DNavigationIntent(candidate) || m6dNavigationCommandKey(candidate) !== pending.key) {
          rollbackPendingNavigation();
        }
      }
      const immediateDestination = m6dVoiceDestinationForIntent(voiceStateRef.current.destination, candidate);
      if (isM6DNavigationIntent(candidate) || isM6DDiagnosisDirectOpenIntent(candidate) || immediateDestination?.kind === "investigation") {
        const observed = text;
        fastNavigationTimer.current = setTimeout(() => {
          fastNavigationTimer.current = null;
          if (voiceStateRef.current.session === "listening" && latestPreviewRef.current === observed) {
            if (isM6DNavigationIntent(candidate) && immediateDestination?.kind === "note") routePendingNavigation(candidate, false);
            // Define the command boundary without stopping the microphone or
            // WebSocket. The provider flushes and clears exactly this utterance.
            dictation.commitUtterance();
          }
        }, FAST_NAVIGATION_STABLE_MS);
      }
    }

    if (mode === "guided") {
      const observed = text;
      silenceTimer.current = setTimeout(() => {
        silenceTimer.current = null;
        // Guided Voice keeps one provider session open. Force an utterance
        // boundary after stable silence so ordinary dictation is committed to
        // the current destination instead of remaining indefinitely in
        // "Hearing". This also clears ignored speech while paused so Resume
        // starts from a clean provider buffer.
        if (voiceStateRef.current.session !== "idle" && latestPreviewRef.current === observed) {
          dictation.commitUtterance();
        }
      }, SILENCE_FINALIZE_MS);
      return;
    }

    silenceTimer.current = setTimeout(() => {
      silenceTimer.current = null;
      if (voiceStateRef.current.session === "listening") stopRef.current?.();
    }, SILENCE_FINALIZE_MS);
  }

  function writeDraft(key: M6DTarget, next: string) {
    const before = valuesRef.current[key] ?? "";
    if (next === before) return;
    valuesRef.current = { ...valuesRef.current, [key]: next };
    recordChange({ kind: "note", target: key, before, after: next });
    onChange(key, next);
  }

  function appendDraft(key: M6DTarget, text: string) {
    const current = valuesRef.current[key] ?? "";
    const result = insertTranscript(current, text, current.length);
    writeDraft(key, result.text);
  }

  function focusDestination(destination: M6DVoiceDestination) {
    requestAnimationFrame(() => {
      const element = document.querySelector(m6dVoiceFocusSelector(destination));
      element?.closest("[data-m6d-section]")?.scrollIntoView({ behavior: "instant", block: "start" });
      if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    });
  }

  function navigate(next: M6DTarget) {
    const destination: M6DVoiceDestination = { kind: "note", target: next };
    setDestination(destination, `Current target: ${LABELS[next]}.`);
    focusDestination(destination);
  }

  function applyDiagnosisIntent(intent: M6DDiagnosisIntent) {
    if (intent.type === "DIAGNOSIS_NAVIGATE") {
      return applyDiagnosisIntent({ type: "DIAGNOSIS_TARGET", target: "title" });
    }

    const destination = m6dVoiceDestinationForIntent(voiceStateRef.current.destination, intent);
    if (destination) setDestination(destination);

    const draft = diagnosisDraftRef.current;
    if (!draft) {
      pendingDiagnosisIntentRef.current = intent;
      onOpenDiagnosis();
      return;
    }

    if (intent.type === "DIAGNOSIS_TARGET") {
      focusDestination({ kind: "diagnosis", target: intent.target });
      setStatus(intent.target === "title"
        ? "Diagnosis field focused. Ordinary speech will enter the editable diagnosis draft."
        : intent.target === "certainty"
          ? "Diagnosis certainty focused. Say Provisional, Working, Confirmed, or Ruled out."
          : "Diagnosis note focused. Ordinary speech will enter the optional diagnosis note.");
      return;
    }

    if (intent.type === "DIAGNOSIS_CERTAINTY") {
      setDestination({ kind: "diagnosis", target: "certainty" });
      const next = { ...draft, certainty: intent.certainty };
      diagnosisDraftRef.current = next;
      onDiagnosisDraftChange(next);
      requestAnimationFrame(() => (document.querySelector(`[data-m6d-diagnosis-certainty-option="${intent.certainty}"]`) as HTMLElement | null)?.focus({ preventScroll: true }));
      setStatus(`Diagnosis certainty selected: ${intent.certainty.replace("_", " ").toLowerCase()}. Review remains editable until Add diagnosis.`);
      return;
    }

    requestAnimationFrame(() => (document.querySelector("[data-m6d-diagnosis-submit]") as HTMLElement | null)?.focus({ preventScroll: true }));
    setStatus("Diagnosis draft is ready for review. Press Add diagnosis explicitly to create it.");
  }
  React.useEffect(() => {
    applyDiagnosisIntentRef.current = applyDiagnosisIntent;
  });
  React.useEffect(() => {
    diagnosisDraftRef.current = diagnosisDraft;
    const pending = pendingDiagnosisIntentRef.current;
    if (diagnosisDraft && pending) {
      pendingDiagnosisIntentRef.current = null;
      applyDiagnosisIntentRef.current(pending);
    }
  }, [diagnosisDraft]);
  function appendDiagnosisDraft(text: string): boolean {
    const draft = diagnosisDraftRef.current;
    const destination = voiceStateRef.current.destination;
    const targetField = destination.kind === "diagnosis" ? destination.target : null;
    if (!draft || (targetField !== "title" && targetField !== "note")) return false;
    const current = draft[targetField];
    const result = insertTranscript(current, text, current.length);
    const next = { ...draft, [targetField]: result.text };
    recordChange({ kind: "diagnosis", target: targetField, before: current, after: result.text });
    diagnosisDraftRef.current = next;
    onDiagnosisDraftChange(next);
    setStatus(targetField === "title"
      ? "Inserted into the editable Diagnosis field. Add diagnosis still requires an explicit press."
      : "Inserted into the optional Diagnosis note. Add diagnosis still requires an explicit press.");
    return true;
  }

  function updateDiagnosisField(targetField: "title" | "note", nextValue: string) {
    const draft = diagnosisDraftRef.current;
    if (!draft || draft[targetField] === nextValue) return;
    recordChange({ kind: "diagnosis", target: targetField, before: draft[targetField], after: nextValue });
    const next = { ...draft, [targetField]: nextValue };
    diagnosisDraftRef.current = next;
    onDiagnosisDraftChange(next);
  }

  function applyDiagnosisEdit(intent: Exclude<M6DLocalIntent, { type: "NONE" }>): boolean {
    const destination = voiceStateRef.current.destination;
    const targetField = destination.kind === "diagnosis" ? destination.target : null;
    const draft = diagnosisDraftRef.current;
    if (!draft || (targetField !== "title" && targetField !== "note")) return false;
    const label = targetField === "title" ? "Diagnosis field" : "Diagnosis note";
    if (intent.type === "UNDO") {
      const change = lastChangeRef.current;
      if (!change || change.kind !== "diagnosis" || change.target !== targetField || draft[targetField] !== change.after) {
        setStatus(`Nothing to undo in ${label}.`);
        return true;
      }
      const next = { ...draft, [targetField]: change.before };
      diagnosisDraftRef.current = next;
      recordChange(null);
      onDiagnosisDraftChange(next);
      setStatus(`Last voice change undone in ${label}.`);
      return true;
    }
    if (intent.type === "REMOVE_LAST_SENTENCE") {
      updateDiagnosisField(targetField, applyM6DTextEdit(draft[targetField], intent) ?? draft[targetField]);
      setStatus(`Last sentence removed from ${label}.`);
      return true;
    }
    if (intent.type === "NOTE_EDIT" && intent.operation === "READ") {
      setStatus(draft[targetField] ? `${label}: ${draft[targetField]}` : `${label} is empty.`);
      return true;
    }
    if (intent.type === "NOTE_EDIT") {
      const nextValue = applyM6DTextEdit(draft[targetField], intent);
      if (nextValue === null) return false;
      updateDiagnosisField(targetField, nextValue);
      setStatus(`${label} updated. Saved diagnoses were not changed.`);
      return true;
    }
    return false;
  }

  function applyInvestigationIntent(intent: M6DInvestigationIntent) {
    void intent;
    setDestination({ kind: "investigation", target: "field" });
    onFocusInvestigation();
    setStatus("Investigation search field focused. Ordinary speech may edit the search; staging still requires an explicit action.");
  }

  function handOffClinicalAction(text: string) {
    window.dispatchEvent(new CustomEvent(M6D_CLINICAL_EVENT, { detail: { text } }));
    setStatus("Clinical action moved to the protected proposal/review surface. Nothing was silently applied.");
  }

  function applyDestinationEdit(intent: M6DLocalIntent): boolean {
    const destination = voiceStateRef.current.destination;
    if (intent.type === "NOTE_EDIT" && intent.operation === "REPLACE_LAST" && !intent.replacement) {
      pendingReplaceLastRef.current = destination;
      setStatus("Replace last sentence: say the replacement sentence now. Other voice commands remain available.");
      return true;
    }
    pendingReplaceLastRef.current = null;
    if (destination.kind === "diagnosis") return applyDiagnosisEdit(intent as Exclude<M6DLocalIntent, { type: "NONE" }>);
    if (destination.kind === "investigation") {
      const undo = lastChangeRef.current?.kind === "investigation" ? lastChangeRef.current : null;
      const result = onEditInvestigation(intent, undo);
      if (!result.handled) return false;
      if (result.mutation) recordChange({ kind: "investigation", ...result.mutation });
      else if (intent.type === "UNDO") recordChange(null);
      setStatus(result.message);
      return true;
    }
    if (intent.type === "UNDO") {
      undoLast();
      return true;
    }
    const current = valuesRef.current[destination.target] ?? "";
    if (intent.type === "NOTE_EDIT" && intent.operation === "READ") {
      setStatus(current ? `${LABELS[destination.target]}: ${current}` : `${LABELS[destination.target]} is empty.`);
      if (current && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(current));
      }
      return true;
    }
    const next = applyM6DTextEdit(current, intent);
    if (next === null) return false;
    writeDraft(destination.target, next);
    setStatus(`${LABELS[destination.target]} editable draft updated.`);
    return true;
  }

  function applyLocal(intent: Exclude<M6DLocalIntent, { type: "NONE" }>) {
    const priority = m6dCommandPriority(intent);
    if (priority === "session") {
      if (intent.type === "PAUSE") return pauseSession(true);
      if (intent.type === "RESUME") return resumeSession(true);
      if (intent.type === "END") return endSession();
      if (intent.type === "UNDO") return applyDestinationEdit(intent);
    }
    if (priority === "edit" && applyDestinationEdit(intent)) return;
    if (priority === "navigation") {
      if (isM6DDiagnosisIntent(intent)) return applyDiagnosisIntent(intent);
      if (isM6DInvestigationIntent(intent)) return applyInvestigationIntent(intent);
      const destination = m6dVoiceDestinationForIntent(voiceStateRef.current.destination, intent);
      if (!destination) return;
      if (destination.kind === "note") return navigate(destination.target);
      if (destination.kind === "diagnosis") return applyDiagnosisIntent({ type: "DIAGNOSIS_TARGET", target: destination.target });
      return applyInvestigationIntent({ type: "INVESTIGATION_TARGET", target: "field" });
    }
    if (priority === "certainty" && isM6DDiagnosisIntent(intent)) return applyDiagnosisIntent(intent);
    if (priority === "clinical-action" && isM6DDiagnosisIntent(intent)) return applyDiagnosisIntent(intent);
  }

  function handleProviderFinal(rawText: string) {
    if (mode !== "guided") return;
    const local = parseM6DLocalCommand(rawText);
    if (local.type === "NONE") {
      rollbackPendingNavigation();
      return;
    }
    if (isM6DNavigationIntent(local) && m6dVoiceDestinationForIntent(voiceStateRef.current.destination, local)?.kind === "note") {
      routePendingNavigation(local, true);
    }
    // Every deterministic standalone command defines its own utterance boundary.
    // This prevents persistent provider buffers from delaying or replaying controls.
    dictation.commitUtterance();
    clearSilenceTimer();
    if (fastNavigationTimer.current) clearTimeout(fastNavigationTimer.current);
    fastNavigationTimer.current = null;
  }

  async function handleFinal(rawText: string, restart = true) {
    clearSilenceTimer();
    setPreview("");
    const pendingNavigation = voiceStateRef.current.pendingNavigation;
    const rawFinalLocal = parseM6DLocalCommand(rawText);
    if (pendingNavigation && isM6DNavigationIntent(rawFinalLocal) && m6dNavigationCommandKey(rawFinalLocal) === pendingNavigation.key) {
      commitVoiceState((current) => ({ ...current, pendingNavigation: null }));
      if (restart) scheduleRestart();
      return;
    }
    if (pendingNavigation && !pendingNavigation.consumed) rollbackPendingNavigation();
    const text = await normalizeTranscript(rawText, voiceLanguage.lang);
    if (mode === "ambient") {
      setAmbientDraft((current) => [current.trim(), text.trim()].filter(Boolean).join(" "));
      setStatus("Ambient speech prepared for review. No diagnosis, prescription or finalized record was changed.");
      if (restart) scheduleRestart();
      return;
    }
    const local = parseM6DLocalCommand(text);
    if (local.type !== "NONE") {
      const mayRunPaused = local.type === "RESUME" || local.type === "END" || local.type === "UNDO";
      if (voiceStateRef.current.session === "paused" && !mayRunPaused) {
        setStatus("Voice session is paused. Say Resume or use the Resume button to continue dictation.");
        return;
      }
      applyLocal(local);
      if (restart) scheduleRestart();
      return;
    }
    if (voiceStateRef.current.session === "paused") {
      setStatus("Voice session is paused. Speech was not added to the clinical draft.");
      return;
    }

    if (pendingReplaceLastRef.current) {
      const replacementIntent: M6DLocalIntent = { type: "NOTE_EDIT", operation: "REPLACE_LAST", replacement: text };
      pendingReplaceLastRef.current = null;
      if (applyDestinationEdit(replacementIntent)) {
        setStatus("Last sentence replaced with the spoken replacement. Review the editable draft before continuing.");
        if (restart) scheduleRestart();
        return;
      }
    }

    const destination = voiceStateRef.current.destination;

    // Clinical action safety wins before target-specific dictation. This keeps
    // phrases such as “Add CBC” or “Add Napa…” in the protected proposal flow
    // even while Diagnosis or Investigation fields are focused.
    const parsedClinical = parseM6BCommand(text);
    if (parsedClinical.type !== "UNKNOWN") {
      const section = navigationSection(parsedClinical);
      if (section) navigate(section);
      else handOffClinicalAction(text);
      if (restart) scheduleRestart();
      return;
    }

    // For ordinary note-edit speech, “Add …” means append the content, not the
    // literal word “Add”. This runs only after clinical-action parsing rejected
    // the utterance, so medicine/investigation proposal commands remain safe.
    const appendText = parseM6DAppendText(text);
    const dictationText = appendText ?? text;

    if (destination.kind === "diagnosis" && destination.target === "certainty") {
      setStatus("Diagnosis certainty expects Provisional, Working, Confirmed, or Ruled out. Nothing was inserted.");
      if (restart) scheduleRestart();
      return;
    }

    if (destination.kind === "diagnosis") {
      if (appendDiagnosisDraft(dictationText)) {
        if (restart) scheduleRestart();
        return;
      }
    }

    if (destination.kind === "investigation") {
      const mutation = onAppendInvestigation(dictationText);
      if (mutation) {
        recordChange({ kind: "investigation", ...mutation });
        setStatus("Inserted into the Investigation search field. Nothing was staged or confirmed.");
      }
      if (restart) scheduleRestart();
      return;
    }

    if (!isM6DCommandLikeUtterance(text) || appendText !== null) {
      if (destination.kind !== "note") return;
      appendDraft(destination.target, dictationText);
      setStatus(`Inserted into editable ${LABELS[destination.target]} draft. Existing autosave/version/conflict protections remain active.`);
      if (restart) scheduleRestart();
      return;
    }

    const interpreted = await interpretCommand(text, voiceLanguage.lang);
    if (interpreted && interpreted.type !== "UNKNOWN") {
      const section = navigationSection(interpreted);
      if (section) navigate(section);
      else handOffClinicalAction(text);
      if (restart) scheduleRestart();
      return;
    }
    if (destination.kind !== "note") return;
    appendDraft(destination.target, text);
    setStatus(`Inserted into editable ${LABELS[destination.target]} draft. Existing autosave/version/conflict protections remain active.`);
    if (restart) scheduleRestart();
  }

  const dictation = useDictation({
    language: voiceLanguage.providerLanguage,
    providerMode: LIVE_VOICE_ENABLED ? "deepgram" : "mock",
    continuous: mode === "guided",
    onPreview: previewWithSilenceFinalization,
    onProviderFinal: handleProviderFinal,
    onUtteranceEnd: (text) => void handleFinal(text, false),
    onFinal: (text) => void handleFinal(text),
    onCancel: () => {
      clearSilenceTimer();
      rollbackPendingNavigation();
      commitVoiceState((current) => ({ ...current, pendingNavigation: null }));
      pendingDiagnosisIntentRef.current = null;
      pendingReplaceLastRef.current = null;
      setPreview("");
    },
  });
  React.useEffect(() => {
    startRef.current = dictation.start;
    stopRef.current = dictation.stop;
  }, [dictation.start, dictation.stop]);
  const providerBusy = ["connecting", "listening", "finalizing"].includes(dictation.state);

  function scheduleRestart() {
    if (voiceStateRef.current.session !== "listening") return;
    window.setTimeout(() => {
      if (voiceStateRef.current.session === "listening") startRef.current?.();
    }, VOICE_RESTART_DELAY_MS);
  }

  function startSession() {
    if (disabled) return;
    commitVoiceState((current) => ({ ...current, session: "listening" }));
    setStatus(`Listening continuously · target ${SECTION_LABELS[m6dVoiceSection(voiceStateRef.current.destination)]}. Silence finalizes each utterance automatically.`);
    dictation.start();
  }

  function pauseSession(keepCommandListener = false) {
    clearSilenceTimer();
    commitVoiceState((current) => ({ ...current, session: "paused" }));
    setStatus(keepCommandListener ? "Voice dictation paused. Say Resume to continue." : "Voice session paused.");
    if (providerBusy && !keepCommandListener) dictation.stop();
  }

  function resumeSession(keepCurrentSession = false) {
    if (disabled) return;
    commitVoiceState((current) => ({ ...current, session: "listening" }));
    setStatus(`Voice session resumed · target ${SECTION_LABELS[m6dVoiceSection(voiceStateRef.current.destination)]}.`);
    if (!keepCurrentSession) dictation.start();
  }

  function endSession() {
    clearSilenceTimer();
    rollbackPendingNavigation();
    pendingDiagnosisIntentRef.current = null;
    pendingReplaceLastRef.current = null;
    commitVoiceState((current) => ({ ...current, session: "idle", pendingNavigation: null }));
    setPreview("");
    dictation.cancel();
    setStatus("Voice session ended.");
  }

  function undoLast() {
    const change = lastChangeRef.current;
    const destination = voiceStateRef.current.destination;
    if (!change || change.kind !== "note" || destination.kind !== "note" || destination.target !== change.target) {
      setStatus("Nothing to undo from this voice session.");
      return;
    }
    valuesRef.current = { ...valuesRef.current, [change.target]: change.before };
    onChange(change.target, change.before);
    recordChange(null);
    setStatus(`Last voice change undone in ${LABELS[change.target]}.`);
  }

  function applyAmbientToHistory() {
    const prepared = ambientDraft.trim();
    if (!prepared) return;
    appendDraft("presentIllness", prepared);
    setAmbientDraft("");
    setStatus("Ambient-prepared text moved to editable History draft for normal review/autosave.");
  }

  return (
    <div ref={stickyShellRef} className="sticky top-2 z-40 min-w-0">
    <SectionCard data-m6d-voice-assistant data-voice-mode={LIVE_VOICE_ENABLED ? "live-ai" : "mock"} data-silence-finalize-ms={SILENCE_FINALIZE_MS} className="max-h-[42vh] min-w-0 overflow-y-auto border-brand/25 p-2.5 sm:max-h-none sm:overflow-visible sm:p-4">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Mic2 className="size-4 text-brand" aria-hidden="true" /><h2 className="text-[14px] font-semibold text-ink">Voice Assistant</h2><span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">M6D</span>{sessionActive && !paused ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#a81c1c]"><span className="size-2 animate-pulse rounded-full bg-[#a81c1c]" />Listening</span> : null}</div>
          <p className="mt-1 hidden text-[11px] text-ink-muted sm:block">Notes may enter editable draft fields directly. Clinical actions still require proposal review and explicit Apply.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="hidden sm:contents">
            <VoiceLanguageControl disabled={disabled || providerBusy} />
            <select aria-label="Voice mode" value={mode} disabled={providerBusy} onChange={(e) => setMode(e.target.value as "guided" | "ambient")} className="min-h-11 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><option value="guided">Guided Voice</option><option value="ambient">Ambient Consultation</option></select>
          </div>
          <select aria-label="Current voice target" value={currentSection} disabled={disabled || providerBusy || mode === "ambient"} onChange={(e) => {
            const destination = m6dVoiceDestinationForSection(e.target.value as M6DVoiceSection);
            if (destination.kind === "note") navigate(destination.target);
            else if (destination.kind === "diagnosis") applyDiagnosisIntent({ type: "DIAGNOSIS_TARGET", target: "title" });
            else applyInvestigationIntent({ type: "INVESTIGATION_TARGET", target: "field" });
          }} className="min-h-11 min-w-0 max-w-full rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink">{M6D_VOICE_SECTION_OPTIONS.map((key) => <option key={key} value={key}>{SECTION_LABELS[key]}</option>)}</select>
          {!sessionActive ? <button type="button" onClick={startSession} disabled={disabled || !dictation.supported} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-3 text-[12px] font-semibold text-white disabled:opacity-50"><Play className="size-4" />Start Voice</button> : paused ? <button type="button" onClick={() => resumeSession()} disabled={disabled} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-3 text-[12px] font-semibold text-white disabled:opacity-50"><Play className="size-4" />Resume</button> : <button type="button" onClick={() => pauseSession()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><Pause className="size-4" />Pause</button>}
          {sessionActive ? <button type="button" onClick={endSession} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><Square className="size-3.5 fill-current" />End</button> : null}
          <button type="button" onClick={undoLast} disabled={!lastChange} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink disabled:opacity-45"><Undo2 className="size-4" />Undo</button>
        </div>
      </div>
      <details className="mt-2 sm:hidden">
        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-xl px-2 text-[11px] font-semibold text-brand focus-visible:focus-ring">Voice settings</summary>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <VoiceLanguageControl disabled={disabled || providerBusy} />
          <select aria-label="Voice mode (compact)" value={mode} disabled={providerBusy} onChange={(e) => setMode(e.target.value as "guided" | "ambient")} className="min-h-11 max-w-full rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><option value="guided">Guided Voice</option><option value="ambient">Ambient Consultation</option></select>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[10px] text-ink-muted"><ShieldAlert className="mt-px size-3.5 shrink-0" />A spoken finalize request can only enter the existing protected Review/Finalize path; this assistant cannot sign or finalize.</p>
      </details>
      {preview ? <p role="status" className="mt-2 break-words rounded-xl bg-surface-muted px-3 py-2 text-[12px] text-ink-secondary"><strong>Hearing:</strong> {preview}</p> : null}
      {dictation.error ? <p role="alert" className="mt-2 text-[12px] font-medium text-[#a81c1c]">{dictation.error}</p> : null}
      <p role="status" aria-live="polite" className="mt-2 text-[11px] text-ink-secondary">{status}</p>
      {mode === "ambient" ? <div className="mt-3 rounded-xl border border-brand/20 bg-brand/5 p-3" data-m6d-ambient-prototype><div className="flex items-center gap-2"><Waves className="size-4 text-brand" /><strong className="text-[12px] text-ink">Ambient prototype</strong></div><p className="mt-1 text-[11px] text-ink-muted">Synthetic speech is prepared in a local review buffer. It does not infer examination findings, diagnose, prescribe or finalize.</p><textarea readOnly value={ambientDraft} rows={3} placeholder="Prepared ambient transcript appears here…" className="mt-2 w-full resize-y rounded-xl border border-hairline bg-white px-3 py-2 text-[13px] leading-relaxed text-ink" /><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!ambientDraft.trim()} onClick={applyAmbientToHistory} className="inline-flex min-h-11 items-center rounded-xl bg-brand px-3 text-[12px] font-semibold text-white disabled:opacity-45">Move to editable History draft</button><button type="button" disabled={!ambientDraft.trim()} onClick={() => setAmbientDraft("")} className="inline-flex min-h-11 items-center rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink disabled:opacity-45">Discard prepared text</button></div></div> : null}
      <p className="mt-2 hidden items-start gap-1.5 text-[10px] text-ink-muted sm:flex"><ShieldAlert className="mt-px size-3.5 shrink-0" />A spoken finalize request can only enter the existing protected Review/Finalize path; this assistant cannot sign or finalize.</p>
    </SectionCard>
    </div>
  );
}
