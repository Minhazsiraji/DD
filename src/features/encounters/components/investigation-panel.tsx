"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { M6D_INVESTIGATION_EXAMPLE, m6dInlinePlaceholder } from "../m6d-inline-examples";
import { DictateButton } from "@/features/dictation/components/dictate-button";
import { insertTranscript } from "@/features/dictation/dictation";
import { applyM6DTextEdit } from "@/features/dictation/m6d-voice-state";
import type { M6DLocalIntent } from "@/features/dictation/m6d-intent-router";
import { confirmInvestigationsAction, type InvestigationConfirmationResult } from "../investigation-v1-actions";
import { removeInvestigationAction, updateInvestigationAction } from "../list-actions";
import {
  INVESTIGATION_V1_MAX_NAME,
  INVESTIGATION_V1_MAX_NOTE,
} from "../investigation-v1-contract";
import {
  loadPatientInvestigationHistoryAction,
  loadRecentInvestigationsAction,
} from "../investigation-v1-read-actions";
import type {
  PatientInvestigationHistoryRow,
  RecentInvestigation,
} from "../investigation-v1-queries";
import {
  COMMON_INVESTIGATIONS,
  addStagedInvestigation,
  confirmationButtonLabel,
  hasExactInvestigationChoice,
  removeStagedInvestigation,
  searchInvestigationChoices,
  snapshotStagedInvestigations,
  stagingIsConfirmable,
  updateStagedInvestigation,
  type LocalStagedInvestigation,
  type PendingInvestigationConfirmation,
} from "../investigation-v1-ui";
import type { FindingRow } from "../finding-types";
import type { ListResult } from "../list-schema";
import type { ConsultationSession } from "../use-consultation";

interface InvestigationPanelProps {
  title: string;
  encounterId: string;
  patientId: string;
  confirmed: FindingRow[];
  staged: LocalStagedInvestigation[];
  readOnly: boolean;
  busy: boolean;
  blocked: boolean;
  unknown: PendingInvestigationConfirmation | null;
  actionError: string | null;
  runList: ConsultationSession["runList"];
  retrySync: ConsultationSession["retrySync"];
  clearCoordinatorError: ConsultationSession["clearListError"];
  onStagedChange: (rows: LocalStagedInvestigation[]) => void;
  onUnknownChange: (pending: PendingInvestigationConfirmation | null) => void;
  onActionErrorChange: (message: string | null) => void;
  shownBecauseFilled?: boolean;
}

export interface InvestigationPanelHandle {
  focusVoiceField: () => void;
  appendVoiceText: (text: string) => VoiceFieldMutation | null;
  editVoiceField: (intent: M6DLocalIntent, undo: VoiceFieldMutation | null) => VoiceFieldEditResult;
}

export interface VoiceFieldMutation { before: string; after: string }
export interface VoiceFieldEditResult {
  handled: boolean;
  mutation: VoiceFieldMutation | null;
  message: string;
}

type ReadState = "loading" | "ready" | "unavailable";
type ConfirmationTone = "idle" | "working" | "success" | "warning";

function toListResult(result: InvestigationConfirmationResult): ListResult {
  if (result.ok) return { ok: true, version: result.confirmationVersion };
  if (result.kind === "conflict") {
    return { ok: false, kind: "conflict", message: result.message, server: result.server };
  }
  if (result.kind === "write-unconfirmed") {
    return { ok: false, kind: "write-unconfirmed", message: result.message };
  }
  if (result.kind === "conflict-unloadable") {
    return { ok: false, kind: "conflict-unloadable", message: result.message };
  }
  return { ok: false, kind: "error", message: result.message };
}

function safeDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export const InvestigationPanel = React.forwardRef<InvestigationPanelHandle, InvestigationPanelProps>(function InvestigationPanel({
  title,
  encounterId,
  patientId,
  confirmed,
  staged,
  readOnly,
  busy,
  blocked,
  unknown,
  actionError,
  runList,
  retrySync,
  clearCoordinatorError,
  onStagedChange,
  onUnknownChange,
  onActionErrorChange,
  shownBecauseFilled = false,
}, ref) {
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const [searchText, setSearchText] = React.useState("");
  const [highlighted, setHighlighted] = React.useState(0);
  const [duplicateWarning, setDuplicateWarning] = React.useState<string | null>(null);
  const [noteEditorId, setNoteEditorId] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<RecentInvestigation[]>([]);
  const [recentState, setRecentState] = React.useState<ReadState>("loading");
  const [recentError, setRecentError] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<PatientInvestigationHistoryRow[]>([]);
  const [historyState, setHistoryState] = React.useState<ReadState>("loading");
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [historyPatientId, setHistoryPatientId] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [confirmationTone, setConfirmationTone] = React.useState<ConfirmationTone>("idle");
  const [confirmationMessage, setConfirmationMessage] = React.useState<string | null>(null);
  const [stagedEditMessage, setStagedEditMessage] = React.useState<string | null>(null);
  const [confirmedEditor, setConfirmedEditor] = React.useState<{ id: string; title: string; note: string } | null>(null);
  const [confirmedRemoveId, setConfirmedRemoveId] = React.useState<string | null>(null);
  const [confirmedMutationMessage, setConfirmedMutationMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (readOnly) return;
    let live = true;

    void loadRecentInvestigationsAction().then((result) => {
      if (!live) return;
      if (result.ok) {
        setRecent(result.rows);
        setRecentError(null);
        setRecentState("ready");
      } else {
        setRecent([]);
        setRecentError(result.message);
        setRecentState("unavailable");
      }
    });

    return () => {
      live = false;
    };
  }, [readOnly]);

  React.useEffect(() => {
    let live = true;
    void loadPatientInvestigationHistoryAction(patientId).then((result) => {
      if (!live) return;
      setHistoryPatientId(patientId);
      if (result.ok) {
        setHistory(result.rows);
        setHistoryError(null);
        setHistoryState("ready");
      } else {
        setHistory([]);
        setHistoryError(result.message);
        setHistoryState("unavailable");
      }
    });
    return () => {
      live = false;
    };
  }, [patientId]);

  const searchChoices = React.useMemo(
    () => searchInvestigationChoices(recent, searchText),
    [recent, searchText],
  );
  const customAvailable =
    searchText.trim() !== "" && !hasExactInvestigationChoice(searchChoices, searchText);
  const interactionLocked = readOnly || blocked || unknown !== null;
  const canConfirm =
    !interactionLocked && !busy && stagingIsConfirmable(staged);
  const historyIsCurrent = historyPatientId === patientId;
  const visibleHistory = historyIsCurrent ? history : [];
  const visibleHistoryState: ReadState = historyIsCurrent ? historyState : "loading";
  const visibleHistoryError = historyIsCurrent ? historyError : null;

  React.useImperativeHandle(ref, () => ({
    focusVoiceField() {
      searchInputRef.current?.closest("[data-m6d-section]")?.scrollIntoView({ behavior: "instant", block: "start" });
      searchInputRef.current?.focus({ preventScroll: true });
    },
    appendVoiceText(text: string) {
      if (interactionLocked) return null;
      const after = insertTranscript(searchText, text, searchText.length).text;
      const mutation = { before: searchText, after };
      setSearchText(after);
      setHighlighted(0);
      return mutation;
    },
    editVoiceField(intent, undo) {
      if (interactionLocked) return { handled: true, mutation: null, message: "Investigation search is unavailable." };
      if (intent.type === "UNDO") {
        if (!undo || searchText !== undo.after) {
          return { handled: true, mutation: null, message: "Nothing to undo in Investigation search." };
        }
        setSearchText(undo.before);
        setHighlighted(0);
        return { handled: true, mutation: null, message: "Last voice change undone in Investigation search." };
      }
      const after = applyM6DTextEdit(searchText, intent);
      if (after === null) return { handled: false, mutation: null, message: "" };
      const mutation = after === searchText ? null : { before: searchText, after };
      if (mutation) setSearchText(after);
      setHighlighted(0);
      return { handled: true, mutation, message: mutation ? "Investigation search updated." : "Investigation search was unchanged." };
    },
  }), [interactionLocked, searchText]);

  function updateSearchText(value: string) {
    setSearchText(value);
    setHighlighted(0);
  }

  function stage(name: string, note: string | null = null) {
    if (interactionLocked) return;
    const result = addStagedInvestigation(
      staged,
      { name, note },
      crypto.randomUUID(),
    );
    if (result.duplicate) {
      setDuplicateWarning(`Duplicate staged investigation — ${name.trim()} is already staged with the same note.`);
      return;
    }
    setDuplicateWarning(null);
    onStagedChange(result.rows);
    setConfirmationTone("idle");
    setConfirmationMessage(null);
  }

  function updateRow(
    localId: string,
    patch: Partial<Pick<LocalStagedInvestigation, "name" | "note">>,
  ) {
    if (interactionLocked) return;
    const result = updateStagedInvestigation(staged, localId, patch);
    if (result.duplicate) {
      setDuplicateWarning("Duplicate staged investigation — the same investigation and note already exist in staging.");
      return;
    }
    setDuplicateWarning(null);
    onStagedChange(result.rows);
  }

  function removeRow(localId: string) {
    if (interactionLocked) return;
    const removed = staged.find((row) => row.localId === localId);
    onStagedChange(removeStagedInvestigation(staged, localId));
    setDuplicateWarning(null);
    setStagedEditMessage(`${removed?.name.trim() || "Investigation"} removed from staging. Nothing was confirmed or deleted from clinical history.`);
    if (noteEditorId === localId) setNoteEditorId(null);
  }

  function addFromSearch(index = highlighted) {
    const choice = searchChoices[index];
    if (choice) {
      stage(choice.name);
      updateSearchText("");
      searchInputRef.current?.focus();
      return;
    }
    if (customAvailable) {
      stage(searchText);
      updateSearchText("");
      searchInputRef.current?.focus();
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && searchChoices.length > 0) {
      event.preventDefault();
      setHighlighted((current) => Math.min(searchChoices.length - 1, current + 1));
    } else if (event.key === "ArrowUp" && searchChoices.length > 0) {
      event.preventDefault();
      setHighlighted((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      addFromSearch(searchChoices.length > 0 ? highlighted : -1);
    } else if (event.key === "Escape") {
      updateSearchText("");
    }
  }

  async function confirmStaged() {
    if (!canConfirm) return;
    const payload = snapshotStagedInvestigations(staged);
    const operationKey = crypto.randomUUID();
    let expectedVersion: number | null = null;
    const backendBox: { value: InvestigationConfirmationResult | null } = { value: null };

    setConfirmationTone("working");
    setConfirmationMessage("Confirming Investigation orders…");
    onActionErrorChange(null);
    clearCoordinatorError();

    const listResult = await runList(
      "investigation",
      async (version) => {
        expectedVersion = version;
        backendBox.value = await confirmInvestigationsAction({
          encounterId,
          expectedVersion: version,
          operationKey,
          investigations: payload,
        });
        return toListResult(backendBox.value);
      },
      { closeEditorOnSuccess: false },
    );
    const backendResult = backendBox.value as InvestigationConfirmationResult | null;

    if (!listResult || !backendResult || expectedVersion === null) {
      setConfirmationTone("idle");
      setConfirmationMessage(null);
      return;
    }

    if (backendResult.ok) {
      onStagedChange([]);
      onUnknownChange(null);
      setConfirmationTone("success");
      setConfirmationMessage(
        `${backendResult.confirmedCount} ${backendResult.confirmedCount === 1 ? "investigation" : "investigations"} confirmed.`,
      );
      return;
    }

    if (backendResult.kind === "write-unconfirmed") {
      onUnknownChange({
        operationKey,
        expectedVersion,
        investigations: payload,
      });
      setConfirmationTone("warning");
      setConfirmationMessage(
        "Confirmation outcome is not yet known. Staging is frozen until the same confirmation is retried.",
      );
      return;
    }

    onUnknownChange(null);
    setConfirmationTone("warning");
    if (backendResult.kind === "error") {
      onActionErrorChange(backendResult.message);
      clearCoordinatorError();
      setConfirmationMessage(null);
    } else if (backendResult.kind === "conflict") {
      setConfirmationMessage("The encounter changed. Resolve the consultation conflict before confirming again.");
    } else {
      setConfirmationMessage("The encounter state could not be reloaded. Your staged investigations remain here.");
    }
  }

  async function retryUnknownConfirmation() {
    if (!unknown || busy) return;

    setConfirmationTone("working");
    setConfirmationMessage("Retrying the same Investigation confirmation…");
    onActionErrorChange(null);
    clearCoordinatorError();

    // The first uncertain attempt deliberately closed the one consultation gate.
    // Reconcile the screen first, then replay the exact operation identity through
    // the SAME runList/MutationGate path. The callback intentionally ignores the
    // current coordinator version and reuses the frozen expectedVersion.
    await retrySync();

    const backendBox: { value: InvestigationConfirmationResult | null } = { value: null };
    const listResult = await runList(
      "investigation",
      async () => {
        backendBox.value = await confirmInvestigationsAction({
          encounterId,
          expectedVersion: unknown.expectedVersion,
          operationKey: unknown.operationKey,
          investigations: unknown.investigations,
        });
        return toListResult(backendBox.value);
      },
      { closeEditorOnSuccess: false },
    );
    const backendResult = backendBox.value as InvestigationConfirmationResult | null;

    if (!listResult || !backendResult) {
      setConfirmationTone("warning");
      setConfirmationMessage(
        "The confirmation is still unresolved. Retry the same confirmation when the consultation can be reconciled.",
      );
      return;
    }

    if (backendResult.ok) {
      onStagedChange([]);
      onUnknownChange(null);
      setConfirmationTone("success");
      setConfirmationMessage(
        `${backendResult.confirmedCount} ${backendResult.confirmedCount === 1 ? "investigation" : "investigations"} confirmed${backendResult.replayed ? " after safe replay" : ""}.`,
      );
      return;
    }

    if (backendResult.kind === "write-unconfirmed") {
      // Keep the exact same key, expected version and payload. Never manufacture
      // a second clinical identity while outcome remains uncertain.
      setConfirmationTone("warning");
      setConfirmationMessage(
        "The confirmation is still unresolved. The same operation identity remains frozen for another retry.",
      );
      return;
    }

    // Conflict/error/conflict-unloadable are definite non-success outcomes for
    // this operation identity. Staging remains, but the uncertain identity no
    // longer blocks later deliberate reconciliation.
    onUnknownChange(null);
    setConfirmationTone("warning");
    if (backendResult.kind === "error") {
      onActionErrorChange(backendResult.message);
      clearCoordinatorError();
      setConfirmationMessage(null);
    } else if (backendResult.kind === "conflict") {
      setConfirmationMessage("The encounter changed. Resolve the conflict before starting a new confirmation.");
    } else {
      setConfirmationMessage("The encounter state could not be reloaded. Your staged investigations remain here.");
    }
  }

  async function saveConfirmedInvestigation() {
    if (!confirmedEditor || interactionLocked || busy) return;
    const title = confirmedEditor.title.trim();
    if (!title) {
      setConfirmedMutationMessage("Investigation name cannot be blank.");
      return;
    }
    const result = await runList(
      "investigation",
      (expectedVersion) => updateInvestigationAction({
        encounterId,
        expectedVersion,
        investigationId: confirmedEditor.id,
        name: title,
        note: confirmedEditor.note.trim() === "" ? null : confirmedEditor.note,
      }),
      { closeEditorOnSuccess: false },
    );
    if (result?.ok) {
      setConfirmedEditor(null);
      setConfirmedMutationMessage("Investigation updated for this unfinished consultation. The change was versioned and audited.");
    }
  }

  async function removeConfirmedInvestigation(row: FindingRow) {
    if (interactionLocked || busy) return;
    if (confirmedRemoveId !== row.id) {
      setConfirmedRemoveId(row.id);
      setConfirmedMutationMessage(`Confirm removal of ${row.title} from this unfinished consultation.`);
      return;
    }
    const result = await runList(
      "investigation",
      (expectedVersion) => removeInvestigationAction({ encounterId, expectedVersion, rowId: row.id }),
      { closeEditorOnSuccess: false },
    );
    if (result?.ok) {
      setConfirmedRemoveId(null);
      setConfirmedEditor((current) => current?.id === row.id ? null : current);
      setConfirmedMutationMessage(`${row.title} removed from this unfinished consultation. The removal remains in the encounter event/audit trail.`);
    }
  }

  return (
    <SectionCard className="min-w-0">
      <SectionHeader
        title={title}
        icon={<FlaskConical className="size-4" aria-hidden="true" />}
        count={confirmed.length}
      />

      {shownBecauseFilled ? (
        <p className="border-b border-white/45 px-4 py-2 text-[12px] text-ink-secondary sm:px-5">
          Shown because this visit already contains information.
        </p>
      ) : null}

      <div className="min-w-0 space-y-5 p-4 sm:p-5">
        {readOnly ? null : (
          <div className="min-w-0 space-y-4">
            <div className="relative min-w-0">
              <label htmlFor="investigation-search" className="mb-1.5 block text-[13px] font-semibold text-ink">
                Search investigations / add custom
              </label>
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  id="investigation-search"
                  type="text"
                  value={searchText}
                  maxLength={INVESTIGATION_V1_MAX_NAME}
                  disabled={interactionLocked}
                  onChange={(event) => updateSearchText(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={m6dInlinePlaceholder(searchText, M6D_INVESTIGATION_EXAMPLE)}
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-controls="investigation-search-results"
                  className="h-11 w-full min-w-0 rounded-xl border border-white/55 bg-white/55 pr-3 pl-10 text-[14px] text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
                />
              </div>
              <DictateButton
                fieldLabel="Investigation order"
                disabled={interactionLocked}
                value={searchText}
                caretAt={searchText.length}
                onInsert={(next) => updateSearchText(next)}
                className="mt-2"
              />

              {searchText.trim() !== "" ? (
                <div
                  id="investigation-search-results"
                  role="listbox"
                  aria-label="Investigation search results"
                  className="dd-material-record dd-record-pearl relative z-10 mt-2 max-h-72 w-full min-w-0 overflow-y-auto rounded-xl p-1.5 shadow-soft"
                >
                  {searchChoices.map((choice, index) => (
                    <button
                      key={`${choice.source}-${choice.name}`}
                      type="button"
                      role="option"
                      aria-selected={index === highlighted}
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => {
                        stage(choice.name);
                        updateSearchText("");
                        searchInputRef.current?.focus();
                      }}
                      disabled={interactionLocked}
                      className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] focus-visible:focus-ring ${index === highlighted ? "bg-white/55" : "hover:bg-white/35"}`}
                    >
                      <span className="min-w-0 break-words font-medium text-ink">{choice.name}</span>
                      <span className="shrink-0 text-[11px] text-ink-muted">
                        {choice.source === "recent" && choice.usageCount
                          ? `Recent · ${choice.usageCount} prior ${choice.usageCount === 1 ? "use" : "uses"}`
                          : "Common"}
                      </span>
                    </button>
                  ))}

                  {customAvailable ? (
                    <button
                      type="button"
                      role="option"
                      aria-selected={searchChoices.length === 0}
                      onClick={() => {
                        stage(searchText);
                        updateSearchText("");
                        searchInputRef.current?.focus();
                      }}
                      disabled={interactionLocked}
                      className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-brand hover:bg-white/35 focus-visible:focus-ring"
                    >
                      <Plus className="size-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-words">Add &ldquo;{searchText.trim()}&rdquo;</span>
                    </button>
                  ) : null}

                  {searchChoices.length === 0 && !customAvailable ? (
                    <p className="px-3 py-2 text-[12px] text-ink-muted">No matching Investigation.</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <section className="min-w-0">
                <h3 className="text-[12px] font-semibold tracking-wide text-ink-secondary uppercase">Common</h3>
                <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                  {COMMON_INVESTIGATIONS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => stage(name)}
                      disabled={interactionLocked}
                      className="dd-secondary inline-flex min-h-11 max-w-full items-center justify-center px-3 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
                    >
                      <span className="break-words">{name}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-ink-secondary uppercase">
                  <Clock3 className="size-3.5" aria-hidden="true" /> Recent
                </h3>
                {recentState === "loading" ? (
                  <p role="status" className="mt-2 text-[12px] text-ink-muted">Loading recent Investigation wording…</p>
                ) : recentState === "unavailable" ? (
                  <p role="status" className="mt-2 text-[12px] text-ink-muted">{recentError}</p>
                ) : recent.length === 0 ? (
                  <p className="mt-2 text-[12px] text-ink-muted">No recent Investigation history yet.</p>
                ) : (
                  <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                    {recent.slice(0, 8).map((row) => (
                      <button
                        key={`${row.name}-${row.lastUsedAt}`}
                        type="button"
                        onClick={() => stage(row.name)}
                        disabled={interactionLocked}
                        className="dd-secondary inline-flex min-h-11 max-w-full flex-col items-start justify-center px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
                      >
                        <span className="max-w-full break-words text-[13px] font-semibold text-ink">{row.name}</span>
                        <span className="text-[11px] font-normal text-ink-muted">
                          {row.usageCount} prior {row.usageCount === 1 ? "use" : "uses"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {duplicateWarning ? (
          <p role="alert" className="flex min-w-0 items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] font-medium text-ink">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0 break-words">{duplicateWarning}</span>
          </p>
        ) : null}

        {!readOnly ? (
          <section className="min-w-0" aria-labelledby="investigation-staged-heading">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="investigation-staged-heading" className="text-[14px] font-semibold text-ink">Staged for confirmation</h3>
                <p className="mt-0.5 text-[12px] text-ink-muted">Local only until you confirm the complete staged list.</p>
              </div>
              <span aria-live="polite" className="rounded-full bg-white/45 px-2.5 py-1 text-[12px] font-semibold text-ink-secondary tabular-nums">
                {staged.length}
              </span>
            </div>

            {staged.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-white/55 px-3 py-3 text-[13px] text-ink-muted">
                No investigations staged. Use Common, Recent, search, or custom text above.
              </p>
            ) : (
              <ol className="mt-3 space-y-2.5">
                {staged.map((row, index) => {
                  const noteOpen = noteEditorId === row.localId;
                  return (
                    <li key={row.localId} className="dd-material-record dd-record-pearl min-w-0 rounded-xl p-3 sm:p-4">
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                        <span className="mt-3 hidden w-5 shrink-0 text-right text-[12px] font-semibold text-ink-muted tabular-nums sm:block">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <label htmlFor={`staged-investigation-${row.localId}`} className="mb-1 block text-[12px] font-semibold text-ink-secondary">Edit investigation</label>
                          <input
                            id={`staged-investigation-${row.localId}`}
                            type="text"
                            value={row.name}
                            maxLength={INVESTIGATION_V1_MAX_NAME}
                            disabled={interactionLocked}
                            onChange={(event) => updateRow(row.localId, { name: event.target.value })}
                            onBlur={() => setStagedEditMessage("Staged investigation updated locally. Nothing was confirmed.")}
                            className="h-11 w-full min-w-0 rounded-xl border border-white/55 bg-white/55 px-3 text-[14px] font-medium text-ink outline-none disabled:opacity-55 focus-visible:focus-ring"
                          />

                          {noteOpen ? (
                            <div className="mt-2 min-w-0">
                              <label htmlFor={`staged-note-${row.localId}`} className="mb-1 block text-[12px] font-semibold text-ink-secondary">
                                Optional note
                              </label>
                              <textarea
                                id={`staged-note-${row.localId}`}
                                rows={2}
                                value={row.note ?? ""}
                                maxLength={INVESTIGATION_V1_MAX_NOTE}
                                disabled={interactionLocked}
                                onChange={(event) => updateRow(row.localId, { note: event.target.value })}
                                onBlur={() => setStagedEditMessage("Staged investigation note updated locally. Nothing was confirmed.")}
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") setNoteEditorId(null);
                                }}
                                className="min-h-20 w-full min-w-0 resize-y rounded-xl border border-white/55 bg-white/55 px-3 py-2 text-[13px] text-ink outline-none disabled:opacity-55 focus-visible:focus-ring"
                              />
                              <div className="mt-1 flex justify-between gap-2 text-[11px] text-ink-muted">
                                <span>Instruction/context only; no result or interpretation.</span>
                                <span className="shrink-0 tabular-nums">{(row.note ?? "").length}/{INVESTIGATION_V1_MAX_NOTE}</span>
                              </div>
                            </div>
                          ) : row.note ? (
                            <p className="mt-2 whitespace-pre-wrap break-words text-[13px] text-ink-secondary">{row.note}</p>
                          ) : null}

                          <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
                            <button
                              type="button"
                              disabled={interactionLocked}
                              onClick={() => setNoteEditorId(noteOpen ? null : row.localId)}
                              className="dd-secondary inline-flex min-h-11 w-full items-center justify-center px-3 text-[12px] font-semibold disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
                            >
                              {noteOpen ? "Close note" : row.note ? "Edit note" : "+ Add note"}
                            </button>
                            <button
                              type="button"
                              disabled={interactionLocked}
                              onClick={() => removeRow(row.localId)}
                              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
                            >
                              <X className="size-4" aria-hidden="true" /> Remove staged
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {stagedEditMessage ? <p role="status" aria-live="polite" className="mt-2 text-[12px] text-ink-secondary">{stagedEditMessage}</p> : null}

            {actionError ? (
              <p role="alert" className="mt-3 flex min-w-0 items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-[#a81c1c]">
                <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{actionError}</span>
              </p>
            ) : null}

            {unknown ? (
              <div role="alert" aria-live="assertive" className="mt-3 min-w-0 rounded-xl bg-warning-soft p-3 sm:p-4">
                <div className="flex min-w-0 items-start gap-2">
                  <AlertTriangle className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-ink">Confirmation outcome unknown</p>
                    <p className="mt-1 break-words text-[12px] text-ink-secondary">
                      Do not edit or resubmit these rows under a new operation. Retry the exact same confirmation to reconcile it safely.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void retryUnknownConfirmation()}
                  disabled={busy}
                  className="dd-primary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  Retry same confirmation
                </button>
              </div>
            ) : null}

            {confirmationMessage ? (
              <p
                role={confirmationTone === "warning" ? "alert" : "status"}
                aria-live="polite"
                className={`mt-3 flex min-w-0 items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium ${confirmationTone === "success" ? "bg-success-soft text-ink" : confirmationTone === "warning" ? "bg-warning-soft text-ink" : "bg-white/38 text-ink-secondary"}`}
              >
                {confirmationTone === "working" ? (
                  <Loader2 className="mt-px size-4 shrink-0 animate-spin" aria-hidden="true" />
                ) : confirmationTone === "success" ? (
                  <CheckCircle2 className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
                )}
                <span className="min-w-0 break-words">{confirmationMessage}</span>
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void confirmStaged()}
              disabled={!canConfirm}
              className="dd-primary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
            >
              {busy && !unknown ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
              {busy && !unknown ? "Confirming…" : confirmationButtonLabel(staged.length)}
            </button>
          </section>
        ) : null}

        <section className="min-w-0" aria-labelledby="confirmed-investigation-heading">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h3 id="confirmed-investigation-heading" className="text-[14px] font-semibold text-ink">Confirmed this consultation</h3>
            <span className="rounded-full bg-white/45 px-2.5 py-1 text-[12px] font-semibold text-ink-secondary tabular-nums">{confirmed.length}</span>
          </div>
          {confirmed.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-muted">No confirmed Investigation orders in this consultation.</p>
          ) : (
            <ol className="mt-2 divide-y divide-white/45">
              {confirmed.map((row) => {
                const editing = confirmedEditor?.id === row.id;
                const confirmingRemove = confirmedRemoveId === row.id;
                return (
                  <li key={row.id} className="flex min-w-0 items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="mt-0.5 w-5 shrink-0 text-right text-[12px] font-semibold text-ink-muted tabular-nums">{row.position}</span>
                    <div className="min-w-0 flex-1">
                      {editing && confirmedEditor ? (
                        <div className="space-y-2 rounded-xl border border-white/55 bg-white/35 p-3">
                          <label className="block text-[12px] font-semibold text-ink-secondary" htmlFor={`confirmed-investigation-title-${row.id}`}>Edit investigation</label>
                          <input
                            id={`confirmed-investigation-title-${row.id}`}
                            value={confirmedEditor.title}
                            maxLength={INVESTIGATION_V1_MAX_NAME}
                            onChange={(event) => setConfirmedEditor({ ...confirmedEditor, title: event.target.value })}
                            disabled={interactionLocked || busy}
                            className="h-11 w-full rounded-xl border border-white/55 bg-white/55 px-3 text-[14px] text-ink outline-none focus-visible:focus-ring disabled:opacity-55"
                          />
                          <label className="block text-[12px] font-semibold text-ink-secondary" htmlFor={`confirmed-investigation-note-${row.id}`}>Optional note</label>
                          <textarea
                            id={`confirmed-investigation-note-${row.id}`}
                            rows={2}
                            value={confirmedEditor.note}
                            maxLength={INVESTIGATION_V1_MAX_NOTE}
                            onChange={(event) => setConfirmedEditor({ ...confirmedEditor, note: event.target.value })}
                            disabled={interactionLocked || busy}
                            className="min-h-20 w-full resize-y rounded-xl border border-white/55 bg-white/55 px-3 py-2 text-[13px] text-ink outline-none focus-visible:focus-ring disabled:opacity-55"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => void saveConfirmedInvestigation()} disabled={interactionLocked || busy || !confirmedEditor.title.trim()} className="dd-primary inline-flex min-h-11 items-center justify-center px-3 text-[12px] font-semibold disabled:opacity-55">Save correction</button>
                            <button type="button" onClick={() => setConfirmedEditor(null)} disabled={busy} className="dd-secondary inline-flex min-h-11 items-center justify-center px-3 text-[12px] font-semibold disabled:opacity-55">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 break-words text-[14px] font-medium text-ink">{row.title}</p>
                            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-ink-secondary">Ordered</span>
                          </div>
                          {row.note ? <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-ink-secondary">{row.note}</p> : null}
                          {!readOnly ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => { setConfirmedEditor({ id: row.id, title: row.title, note: row.note ?? "" }); setConfirmedRemoveId(null); setConfirmedMutationMessage(null); }}
                                disabled={interactionLocked || busy}
                                className="dd-secondary inline-flex min-h-11 items-center justify-center gap-1.5 px-3 text-[12px] font-semibold disabled:opacity-55"
                              >
                                <Pencil className="size-3.5" aria-hidden="true" /> Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeConfirmedInvestigation(row)}
                                disabled={interactionLocked || busy}
                                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-55 focus-visible:focus-ring"
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" /> {confirmingRemove ? "Confirm remove" : "Remove"}
                              </button>
                              {confirmingRemove ? (
                                <button type="button" onClick={() => { setConfirmedRemoveId(null); setConfirmedMutationMessage(null); }} disabled={busy} className="dd-secondary inline-flex min-h-11 items-center justify-center px-3 text-[12px] font-semibold disabled:opacity-55">Keep</button>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {confirmedMutationMessage ? <p role="status" aria-live="polite" className="mt-2 text-[12px] text-ink-secondary">{confirmedMutationMessage}</p> : null}
        </section>

        <section className="min-w-0 border-t border-white/45 pt-4">
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            aria-controls="previous-investigation-history"
            className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl px-2 text-left text-[13px] font-semibold text-ink hover:bg-white/28 focus-visible:focus-ring"
          >
            <span className="min-w-0 break-words">Previous Investigation history</span>
            {historyOpen ? <ChevronUp className="size-4 shrink-0" aria-hidden="true" /> : <ChevronDown className="size-4 shrink-0" aria-hidden="true" />}
          </button>

          {historyOpen ? (
            <div id="previous-investigation-history" className="mt-2 min-w-0">
              {visibleHistoryState === "loading" ? (
                <p role="status" className="text-[12px] text-ink-muted">Loading previous Investigation history…</p>
              ) : visibleHistoryState === "unavailable" ? (
                <p role="status" className="text-[12px] text-ink-muted">{visibleHistoryError}</p>
              ) : visibleHistory.length === 0 ? (
                <p className="text-[12px] text-ink-muted">No prior Investigation orders found for this patient.</p>
              ) : (
                <ol className="space-y-2">
                  {visibleHistory.map((row) => (
                    <li key={row.investigationId} className="dd-material-record dd-record-pearl min-w-0 rounded-xl px-3 py-2.5">
                      <p className="break-words text-[13px] font-semibold text-ink">{row.investigationName}</p>
                      {row.note ? <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-ink-secondary">{row.note}</p> : null}
                      <p className="mt-1 break-words text-[11px] text-ink-muted">
                        {safeDateTime(row.orderedAt)} · {row.practiceLocationName}
                        {row.orderingDoctorName ? ` · ${row.orderingDoctorName}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </SectionCard>
  );
});

InvestigationPanel.displayName = "InvestigationPanel";
