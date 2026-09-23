"use client";

import * as React from "react";
import { Mic2, Pause, Play, ShieldAlert, Square, Undo2, Waves } from "lucide-react";
import type { DraftKey, DraftValues } from "../schema";
import type { FindingDraft } from "../finding-types";
import { insertTranscript } from "@/features/dictation/dictation";
import { useDictation } from "@/features/dictation/use-dictation";
import { LIVE_VOICE_ENABLED, useVoiceLanguage, VoiceLanguageControl } from "@/features/dictation/voice-language";
import { isM6DCommandLikeUtterance, isM6DDiagnosisIntent, isM6DInvestigationIntent, isM6DNavigationIntent, isM6DStandaloneControlIntent, m6dNavigationCommandKey, parseM6DLocalCommand, M6D_TARGETS, nextM6DTarget, removeM6DLastSentence, resolveM6DExtendedSectionStep, resolveM6DNavigationTarget, type M6DDiagnosisIntent, type M6DExtendedSection, type M6DInvestigationIntent, type M6DLocalIntent, type M6DNavigationIntent, type M6DTarget } from "@/features/dictation/m6d-intent-router";
import { parseM6BCommand, type M6BIntent } from "@/features/dictation/m6b-command-parser";

const LABELS: Record<M6DTarget, string> = {
  chiefComplaints: "Chief complaint",
  presentIllness: "History",
  examination: "Examination",
  assessment: "Assessment",
  advice: "Advice",
  nextVisitNote: "Follow-up",
};
const M6D_CLINICAL_EVENT = "dd:m6d-clinical-command";
const SILENCE_FINALIZE_MS = 800;
const FAST_NAVIGATION_STABLE_MS = 80;
const VOICE_RESTART_DELAY_MS = 100;

type LastDraftChange = { key: M6DTarget; before: string; after: string } | null;
type LastDiagnosisChange = { target: "title" | "note"; before: string; after: string } | null;
type DiagnosisVoiceTarget = "title" | "certainty" | "note" | null;
type PendingNavigation = {
  key: string;
  target: M6DTarget;
  previousTarget: M6DTarget;
  consumed: boolean;
};

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
}: {
  values: DraftValues;
  diagnosisDraft: FindingDraft | null;
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  onOpenDiagnosis: () => void;
  onDiagnosisDraftChange: (draft: FindingDraft) => void;
  onFocusInvestigation: () => void;
  onAppendInvestigation: (text: string) => boolean;
}) {
  const voiceLanguage = useVoiceLanguage();
  const [target, setTarget] = React.useState<M6DTarget>("chiefComplaints");
  const [sessionActive, setSessionActive] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [mode, setMode] = React.useState<"guided" | "ambient">("guided");
  const [preview, setPreview] = React.useState("");
  const [status, setStatus] = React.useState("Ready. Start Voice once, then speak naturally or use short commands.");
  const [ambientDraft, setAmbientDraft] = React.useState("");
  const [lastChange, setLastChange] = React.useState<LastDraftChange>(null);
  const activeExtendedSectionRef = React.useRef<M6DExtendedSection | null>(null);
  const activeRef = React.useRef(false);
  const pausedRef = React.useRef(false);
  const startRef = React.useRef<(() => void) | null>(null);
  const stopRef = React.useRef<(() => void) | null>(null);
  const silenceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fastNavigationTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPreviewRef = React.useRef("");
  const targetRef = React.useRef<M6DTarget>("chiefComplaints");
  const pendingNavigationRef = React.useRef<PendingNavigation | null>(null);
  const diagnosisDraftRef = React.useRef<FindingDraft | null>(diagnosisDraft);
  const diagnosisTargetRef = React.useRef<DiagnosisVoiceTarget>(null);
  const investigationTargetRef = React.useRef<"field" | null>(null);
  const lastDiagnosisChangeRef = React.useRef<LastDiagnosisChange>(null);
  const pendingDiagnosisIntentRef = React.useRef<M6DDiagnosisIntent | null>(null);
  const applyDiagnosisIntentRef = React.useRef<(intent: M6DDiagnosisIntent) => void>(() => undefined);

  React.useEffect(() => { activeRef.current = sessionActive; }, [sessionActive]);
  React.useEffect(() => { pausedRef.current = paused; }, [paused]);
  React.useEffect(() => { targetRef.current = target; }, [target]);
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
  React.useEffect(() => () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (fastNavigationTimer.current) clearTimeout(fastNavigationTimer.current);
  }, []);

  function clearSilenceTimer() {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  }

  function rollbackPendingNavigation() {
    const pending = pendingNavigationRef.current;
    if (!pending || pending.consumed) return;
    pendingNavigationRef.current = null;
    if (targetRef.current === pending.target) navigate(pending.previousTarget);
  }

  function routePendingNavigation(intent: M6DNavigationIntent, consumed: boolean) {
    const key = m6dNavigationCommandKey(intent);
    const existing = pendingNavigationRef.current;
    if (existing?.key === key) {
      existing.consumed = existing.consumed || consumed;
      return;
    }
    if (existing && !existing.consumed) rollbackPendingNavigation();
    const previousTarget = targetRef.current;
    const nextTarget = resolveM6DNavigationTarget(intent, previousTarget);
    pendingNavigationRef.current = { key, target: nextTarget, previousTarget, consumed };
    navigate(nextTarget);
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
      const pending = pendingNavigationRef.current;
      if (pending && !pending.consumed) {
        if (!isM6DNavigationIntent(candidate) || m6dNavigationCommandKey(candidate) !== pending.key) {
          rollbackPendingNavigation();
        }
      }
      const extendedStep = (candidate.type === "NEXT" || candidate.type === "PREVIOUS") && activeExtendedSectionRef.current
        ? resolveM6DExtendedSectionStep(activeExtendedSectionRef.current, candidate.type === "NEXT" ? 1 : -1)
        : null;
      if ((isM6DNavigationIntent(candidate) && !extendedStep) || isM6DDiagnosisDirectOpenIntent(candidate)) {
        const observed = text;
        fastNavigationTimer.current = setTimeout(() => {
          fastNavigationTimer.current = null;
          if (activeRef.current && !pausedRef.current && latestPreviewRef.current === observed) {
            if (isM6DNavigationIntent(candidate)) routePendingNavigation(candidate, false);
            // Define the command boundary without stopping the microphone or
            // WebSocket. The provider flushes and clears exactly this utterance.
            dictation.commitUtterance();
          }
        }, FAST_NAVIGATION_STABLE_MS);
      }
    }

    if (mode !== "guided") {
      silenceTimer.current = setTimeout(() => {
        silenceTimer.current = null;
        if (activeRef.current && !pausedRef.current) stopRef.current?.();
      }, SILENCE_FINALIZE_MS);
    }
  }

  function writeDraft(key: M6DTarget, next: string) {
    const before = values[key] ?? "";
    if (next === before) return;
    setLastChange({ key, before, after: next });
    onChange(key, next);
  }

  function appendDraft(key: M6DTarget, text: string) {
    const current = values[key] ?? "";
    const result = insertTranscript(current, text, current.length);
    writeDraft(key, result.text);
  }

  function navigate(next: M6DTarget) {
    const changed = targetRef.current !== next;
    diagnosisTargetRef.current = null;
    investigationTargetRef.current = null;
    activeExtendedSectionRef.current = null;
    targetRef.current = next;
    setTarget(next);
    setStatus(`Current target: ${LABELS[next]}.`);
    if (changed) requestAnimationFrame(() => document.getElementById(next)?.scrollIntoView({ behavior: "instant", block: "center" }));
  }

  function focusDiagnosis(selector: string) {
    requestAnimationFrame(() => {
      const element = document.querySelector(selector);
      element?.scrollIntoView({ behavior: "instant", block: "center" });
      if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    });
  }

  function applyDiagnosisIntent(intent: M6DDiagnosisIntent) {
    if (intent.type === "DIAGNOSIS_NAVIGATE") {
      investigationTargetRef.current = null;
      activeExtendedSectionRef.current = "diagnoses";
      return applyDiagnosisIntent({ type: "DIAGNOSIS_TARGET", target: "title" });
    }

    const draft = diagnosisDraftRef.current;
    if (!draft) {
      pendingDiagnosisIntentRef.current = intent;
      onOpenDiagnosis();
      return;
    }

    if (intent.type === "DIAGNOSIS_TARGET") {
      activeExtendedSectionRef.current = "diagnoses";
      diagnosisTargetRef.current = intent.target;
      const selector = intent.target === "title"
        ? "[data-m6d-diagnosis-title]"
        : intent.target === "certainty"
          ? "[data-m6d-diagnosis-certainty]"
          : "[data-m6d-diagnosis-note]";
      focusDiagnosis(selector);
      setStatus(intent.target === "title"
        ? "Diagnosis field focused. Ordinary speech will enter the editable diagnosis draft."
        : intent.target === "certainty"
          ? "Diagnosis certainty focused. Say Provisional, Working, Confirmed, or Ruled out."
          : "Diagnosis note focused. Ordinary speech will enter the optional diagnosis note.");
      return;
    }

    if (intent.type === "DIAGNOSIS_CERTAINTY") {
      activeExtendedSectionRef.current = "diagnoses";
      diagnosisTargetRef.current = "certainty";
      const next = { ...draft, certainty: intent.certainty };
      diagnosisDraftRef.current = next;
      onDiagnosisDraftChange(next);
      focusDiagnosis(`[data-m6d-diagnosis-certainty-option="${intent.certainty}"]`);
      setStatus(`Diagnosis certainty selected: ${intent.certainty.replace("_", " ").toLowerCase()}. Review remains editable until Add diagnosis.`);
      return;
    }

    diagnosisTargetRef.current = null;
    focusDiagnosis("[data-m6d-diagnosis-submit]");
    setStatus("Diagnosis draft is ready for review. Press Add diagnosis explicitly to create it.");
  }
  function appendDiagnosisDraft(text: string): boolean {
    const draft = diagnosisDraftRef.current;
    const targetField = diagnosisTargetRef.current;
    if (!draft || (targetField !== "title" && targetField !== "note")) return false;
    const current = draft[targetField];
    const result = insertTranscript(current, text, current.length);
    const next = { ...draft, [targetField]: result.text };
    lastDiagnosisChangeRef.current = { target: targetField, before: current, after: result.text };
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
    lastDiagnosisChangeRef.current = { target: targetField, before: draft[targetField], after: nextValue };
    const next = { ...draft, [targetField]: nextValue };
    diagnosisDraftRef.current = next;
    onDiagnosisDraftChange(next);
  }

  function applyDiagnosisEdit(intent: Exclude<M6DLocalIntent, { type: "NONE" }>): boolean {
    const targetField = diagnosisTargetRef.current;
    const draft = diagnosisDraftRef.current;
    if (!draft || (targetField !== "title" && targetField !== "note")) return false;
    const label = targetField === "title" ? "Diagnosis field" : "Diagnosis note";
    if (intent.type === "UNDO") {
      const change = lastDiagnosisChangeRef.current;
      if (!change || change.target !== targetField || draft[targetField] !== change.after) {
        setStatus(`Nothing to undo in ${label}.`);
        return true;
      }
      const next = { ...draft, [targetField]: change.before };
      diagnosisDraftRef.current = next;
      lastDiagnosisChangeRef.current = null;
      onDiagnosisDraftChange(next);
      setStatus(`Last voice change undone in ${label}.`);
      return true;
    }
    if (intent.type === "REMOVE_LAST_SENTENCE") {
      updateDiagnosisField(targetField, removeM6DLastSentence(draft[targetField]));
      setStatus(`Last sentence removed from ${label}.`);
      return true;
    }
    if (intent.type === "NOTE_EDIT" && intent.operation === "CLEAR") {
      updateDiagnosisField(targetField, "");
      setStatus(`${label} cleared. Saved diagnoses were not changed.`);
      return true;
    }
    return false;
  }

  function applyInvestigationIntent(intent: M6DInvestigationIntent) {
    activeExtendedSectionRef.current = "investigations";
    diagnosisTargetRef.current = null;
    if (intent.type === "INVESTIGATION_NAVIGATE") {
      investigationTargetRef.current = null;
      focusDiagnosis("#m6b-investigations");
      setStatus("Current voice section: Investigation orders. Nothing has been staged or confirmed.");
      return;
    }
    investigationTargetRef.current = "field";
    onFocusInvestigation();
    setStatus("Investigation search field focused. Ordinary speech may edit the search; staging still requires an explicit action.");
  }

  function navigateExtended(direction: 1 | -1): boolean {
    const current = activeExtendedSectionRef.current;
    if (!current) return false;
    const next = resolveM6DExtendedSectionStep(current, direction);
    if (!next) return false;
    if (next === "diagnoses") applyDiagnosisIntent({ type: "DIAGNOSIS_NAVIGATE" });
    else applyInvestigationIntent({ type: "INVESTIGATION_NAVIGATE" });
    return true;
  }

  function handOffClinicalAction(text: string) {
    window.dispatchEvent(new CustomEvent(M6D_CLINICAL_EVENT, { detail: { text } }));
    setStatus("Clinical action moved to the protected proposal/review surface. Nothing was silently applied.");
  }

  function applyLocal(intent: Exclude<M6DLocalIntent, { type: "NONE" }>) {
    const current = values[target] ?? "";
    if (intent.type === "NAVIGATE") return navigate(intent.target);
    if (intent.type === "NEXT") return navigateExtended(1) || navigate(nextM6DTarget(target, 1));
    if (intent.type === "PREVIOUS") return navigateExtended(-1) || navigate(nextM6DTarget(target, -1));
    if (intent.type === "PAUSE") return pauseSession(true);
    if (intent.type === "RESUME") return resumeSession(true);
    if (intent.type === "END") return endSession();
    if (applyDiagnosisEdit(intent)) return;
    if (intent.type === "UNDO") return undoLast();
    if (intent.type === "REMOVE_LAST_SENTENCE") return undoLast();
    if (isM6DDiagnosisIntent(intent)) return applyDiagnosisIntent(intent);
    if (isM6DInvestigationIntent(intent)) return applyInvestigationIntent(intent);
    if (intent.type !== "NOTE_EDIT") return;
    if (intent.operation === "CLEAR") {
      writeDraft(target, "");
      setStatus(`${LABELS[target]} cleared in the editable draft.`);
    } else if (intent.operation === "READ") {
      setStatus(current ? `${LABELS[target]}: ${current}` : `${LABELS[target]} is empty.`);
      if (current && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(current));
      }
    } else if (intent.operation === "ADD" && intent.value) {
      appendDraft(target, intent.value);
      setStatus(`Added to ${LABELS[target]} draft.`);
    } else if (intent.operation === "REMOVE" && intent.value) {
      if (!current.includes(intent.value)) setStatus(`Could not find “${intent.value}”. Nothing changed.`);
      else {
        writeDraft(target, current.replace(intent.value, "").replace(/\s{2,}/g, " ").trim());
        setStatus(`Removed requested text from ${LABELS[target]} draft.`);
      }
    } else if (intent.operation === "REPLACE" && intent.value && intent.replacement) {
      if (!current.includes(intent.value)) setStatus(`Could not find “${intent.value}”. Nothing changed.`);
      else {
        writeDraft(target, current.replace(intent.value, intent.replacement));
        setStatus(`Updated ${LABELS[target]} draft.`);
      }
    }
  }

  function handleProviderFinal(rawText: string) {
    if (mode !== "guided") return;
    const local = parseM6DLocalCommand(rawText);
    // A provider-final segment can still grow into ordinary clinical prose.
    // Session controls execute only once the whole utterance is speech-final.
    const diagnosisEdit = diagnosisTargetRef.current === "title" || diagnosisTargetRef.current === "note";
    if (diagnosisEdit && (local.type === "UNDO" || local.type === "REMOVE_LAST_SENTENCE" ||
      (local.type === "NOTE_EDIT" && local.operation === "CLEAR"))) {
      dictation.commitUtterance();
      return;
    }
    if (isM6DDiagnosisDirectOpenIntent(local)) {
      dictation.commitUtterance();
      return;
    }
    if (isM6DStandaloneControlIntent(local) || isM6DDiagnosisIntent(local)) return;
    if (isM6DInvestigationIntent(local)) return;
    if (pausedRef.current) return;
    if (!isM6DNavigationIntent(local)) {
      rollbackPendingNavigation();
      return;
    }
    const extendedStep = (local.type === "NEXT" || local.type === "PREVIOUS") && activeExtendedSectionRef.current
      ? resolveM6DExtendedSectionStep(activeExtendedSectionRef.current, local.type === "NEXT" ? 1 : -1)
      : null;
    if (extendedStep) {
      dictation.commitUtterance();
      return;
    }
    routePendingNavigation(local, true);
    dictation.commitUtterance();
    clearSilenceTimer();
    if (fastNavigationTimer.current) clearTimeout(fastNavigationTimer.current);
    fastNavigationTimer.current = null;
  }

  async function handleFinal(rawText: string, restart = true) {
    clearSilenceTimer();
    setPreview("");
    const pendingNavigation = pendingNavigationRef.current;
    const rawFinalLocal = parseM6DLocalCommand(rawText);
    if (pendingNavigation && isM6DNavigationIntent(rawFinalLocal) && m6dNavigationCommandKey(rawFinalLocal) === pendingNavigation.key) {
      pendingNavigationRef.current = null;
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
      if (pausedRef.current && !isM6DStandaloneControlIntent(local)) {
        setStatus("Voice session is paused. Say Resume or use the Resume button to continue dictation.");
        return;
      }
      applyLocal(local);
      if (restart) scheduleRestart();
      return;
    }
    if (pausedRef.current) {
      setStatus("Voice session is paused. Speech was not added to the clinical draft.");
      return;
    }
    if (appendDiagnosisDraft(text)) {
      if (restart) scheduleRestart();
      return;
    }
    if (investigationTargetRef.current === "field") {
      if (onAppendInvestigation(text)) {
        setStatus("Inserted into the Investigation search field. Nothing was staged or confirmed.");
      }
      if (restart) scheduleRestart();
      return;
    }
    if (diagnosisTargetRef.current === "certainty") {
      setStatus("Diagnosis certainty expects Provisional, Working, Confirmed, or Ruled out. Nothing was inserted.");
      if (restart) scheduleRestart();
      return;
    }
    const parsedClinical = parseM6BCommand(text);
    if (parsedClinical.type !== "UNKNOWN") {
      const section = navigationSection(parsedClinical);
      if (section) navigate(section);
      else handOffClinicalAction(text);
      if (restart) scheduleRestart();
      return;
    }
    if (!isM6DCommandLikeUtterance(text)) {
      appendDraft(targetRef.current, text);
      setStatus(`Inserted into editable ${LABELS[targetRef.current]} draft. Existing autosave/version/conflict protections remain active.`);
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
    appendDraft(targetRef.current, text);
    setStatus(`Inserted into editable ${LABELS[targetRef.current]} draft. Existing autosave/version/conflict protections remain active.`);
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
      pendingNavigationRef.current = null;
      pendingDiagnosisIntentRef.current = null;
      diagnosisTargetRef.current = null;
      investigationTargetRef.current = null;
      activeExtendedSectionRef.current = null;
      setPreview("");
    },
  });
  React.useEffect(() => {
    startRef.current = dictation.start;
    stopRef.current = dictation.stop;
  }, [dictation.start, dictation.stop]);
  const providerBusy = ["connecting", "listening", "finalizing"].includes(dictation.state);

  function scheduleRestart() {
    if (!activeRef.current || pausedRef.current) return;
    window.setTimeout(() => {
      if (activeRef.current && !pausedRef.current) startRef.current?.();
    }, VOICE_RESTART_DELAY_MS);
  }

  function startSession() {
    if (disabled) return;
    activeRef.current = true;
    pausedRef.current = false;
    setSessionActive(true);
    setPaused(false);
    setStatus(`Listening continuously · target ${LABELS[target]}. Silence finalizes each utterance automatically.`);
    dictation.start();
  }

  function pauseSession(keepCommandListener = false) {
    clearSilenceTimer();
    pausedRef.current = true;
    setPaused(true);
    setStatus(keepCommandListener ? "Voice dictation paused. Say Resume to continue." : "Voice session paused.");
    if (providerBusy && !keepCommandListener) dictation.stop();
  }

  function resumeSession(keepCurrentSession = false) {
    if (disabled) return;
    pausedRef.current = false;
    setPaused(false);
    setStatus(`Voice session resumed · target ${LABELS[target]}.`);
    if (!keepCurrentSession) dictation.start();
  }

  function endSession() {
    clearSilenceTimer();
    rollbackPendingNavigation();
    pendingNavigationRef.current = null;
    pendingDiagnosisIntentRef.current = null;
    diagnosisTargetRef.current = null;
    investigationTargetRef.current = null;
    activeExtendedSectionRef.current = null;
    activeRef.current = false;
    pausedRef.current = false;
    setSessionActive(false);
    setPaused(false);
    setPreview("");
    dictation.cancel();
    setStatus("Voice session ended.");
  }

  function undoLast() {
    if (!lastChange) {
      setStatus("Nothing to undo from this voice session.");
      return;
    }
    onChange(lastChange.key, lastChange.before);
    setLastChange(null);
    setStatus(`Last voice change undone in ${LABELS[lastChange.key]}.`);
  }

  function applyAmbientToHistory() {
    const prepared = ambientDraft.trim();
    if (!prepared) return;
    appendDraft("presentIllness", prepared);
    setAmbientDraft("");
    setStatus("Ambient-prepared text moved to editable History draft for normal review/autosave.");
  }

  return (
    <section data-m6d-voice-assistant data-voice-mode={LIVE_VOICE_ENABLED ? "live-ai" : "mock"} data-silence-finalize-ms={SILENCE_FINALIZE_MS} className="sticky bottom-3 z-40 min-w-0 rounded-2xl border border-brand/25 bg-white/95 p-3 shadow-xl backdrop-blur-md sm:p-4">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Mic2 className="size-4 text-brand" aria-hidden="true" /><h2 className="text-[14px] font-semibold text-ink">Voice Assistant</h2><span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">M6D</span>{sessionActive && !paused ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#a81c1c]"><span className="size-2 animate-pulse rounded-full bg-[#a81c1c]" />Listening</span> : null}</div>
          <p className="mt-1 text-[11px] text-ink-muted">Notes may enter editable draft fields directly. Clinical actions still require proposal review and explicit Apply.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <VoiceLanguageControl disabled={disabled || providerBusy} />
          <select aria-label="Voice mode" value={mode} disabled={providerBusy} onChange={(e) => setMode(e.target.value as "guided" | "ambient")} className="min-h-11 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><option value="guided">Guided Voice</option><option value="ambient">Ambient Consultation</option></select>
          <select aria-label="Current voice target" value={target} disabled={disabled || providerBusy || mode === "ambient"} onChange={(e) => navigate(e.target.value as M6DTarget)} className="min-h-11 min-w-0 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink">{M6D_TARGETS.map((key) => <option key={key} value={key}>{LABELS[key]}</option>)}</select>
          {!sessionActive ? <button type="button" onClick={startSession} disabled={disabled || !dictation.supported} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-3 text-[12px] font-semibold text-white disabled:opacity-50"><Play className="size-4" />Start Voice</button> : paused ? <button type="button" onClick={() => resumeSession()} disabled={disabled} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-3 text-[12px] font-semibold text-white disabled:opacity-50"><Play className="size-4" />Resume</button> : <button type="button" onClick={() => pauseSession()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><Pause className="size-4" />Pause</button>}
          {sessionActive ? <button type="button" onClick={endSession} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink"><Square className="size-3.5 fill-current" />End</button> : null}
          <button type="button" onClick={undoLast} disabled={!lastChange} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink disabled:opacity-45"><Undo2 className="size-4" />Undo</button>
        </div>
      </div>
      {preview ? <p role="status" className="mt-2 break-words rounded-xl bg-surface-muted px-3 py-2 text-[12px] text-ink-secondary"><strong>Hearing:</strong> {preview}</p> : null}
      {dictation.error ? <p role="alert" className="mt-2 text-[12px] font-medium text-[#a81c1c]">{dictation.error}</p> : null}
      <p role="status" aria-live="polite" className="mt-2 text-[11px] text-ink-secondary">{status}</p>
      {mode === "ambient" ? <div className="mt-3 rounded-xl border border-brand/20 bg-brand/5 p-3" data-m6d-ambient-prototype><div className="flex items-center gap-2"><Waves className="size-4 text-brand" /><strong className="text-[12px] text-ink">Ambient prototype</strong></div><p className="mt-1 text-[11px] text-ink-muted">Synthetic speech is prepared in a local review buffer. It does not infer examination findings, diagnose, prescribe or finalize.</p><textarea readOnly value={ambientDraft} rows={3} placeholder="Prepared ambient transcript appears here…" className="mt-2 w-full resize-y rounded-xl border border-hairline bg-white px-3 py-2 text-[13px] leading-relaxed text-ink" /><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!ambientDraft.trim()} onClick={applyAmbientToHistory} className="inline-flex min-h-11 items-center rounded-xl bg-brand px-3 text-[12px] font-semibold text-white disabled:opacity-45">Move to editable History draft</button><button type="button" disabled={!ambientDraft.trim()} onClick={() => setAmbientDraft("")} className="inline-flex min-h-11 items-center rounded-xl border border-hairline bg-white px-3 text-[12px] font-semibold text-ink disabled:opacity-45">Discard prepared text</button></div></div> : null}
      <p className="mt-2 flex items-start gap-1.5 text-[10px] text-ink-muted"><ShieldAlert className="mt-px size-3.5 shrink-0" />A spoken finalize request can only enter the existing protected Review/Finalize path; this assistant cannot sign or finalize.</p>
    </section>
  );
}
