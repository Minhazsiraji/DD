"use client";

import * as React from "react";
import { Mic2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import {
  M6F_VOICE_PERSONALIZATION_STORAGE_KEY,
  PERSONAL_COMMAND_TARGETS,
  PERSONAL_FIELD_TARGETS,
  loadDoctorVoicePersonalization,
  validateDoctorVoiceAlias,
  type DoctorVoiceAlias,
  type DoctorVoiceLanguagePreference,
  type DoctorVoicePersonalizationProfile,
} from "../m6f-voice-personalization";

const LANGUAGE_OPTIONS: readonly { value: DoctorVoiceLanguagePreference; label: string }[] = [
  { value: "english", label: "English" },
  { value: "bangla", label: "বাংলা" },
  { value: "banglish", label: "Banglish" },
  { value: "mixed", label: "Mixed / Auto" },
];

type AliasKind = "commandAliases" | "fieldAliases";

export function VoicePersonalizationSettings() {
  const mounted = React.useSyncExternalStore(emptySubscribe, () => true, () => false);
  if (!mounted) return <SectionCard className="h-40 animate-pulse bg-white/55" />;
  return <VoicePersonalizationEditor />;
}

function VoicePersonalizationEditor() {
  const [profile, setProfile] = React.useState<DoctorVoicePersonalizationProfile>(loadDoctorVoicePersonalization);
  const [phrase, setPhrase] = React.useState("");
  const [kind, setKind] = React.useState<AliasKind>("commandAliases");
  const [canonicalUtterance, setCanonicalUtterance] = React.useState<string>(PERSONAL_COMMAND_TARGETS[0].canonicalUtterance);
  const [message, setMessage] = React.useState("No phrase becomes active until you confirm Add phrase.");

  const targets = kind === "commandAliases" ? PERSONAL_COMMAND_TARGETS : PERSONAL_FIELD_TARGETS;

  function persist(next: DoctorVoicePersonalizationProfile, nextMessage: string) {
    window.localStorage.setItem(M6F_VOICE_PERSONALIZATION_STORAGE_KEY, JSON.stringify(next));
    setProfile(next);
    setMessage(nextMessage);
  }

  function changeKind(nextKind: AliasKind) {
    setKind(nextKind);
    const nextTargets = nextKind === "commandAliases" ? PERSONAL_COMMAND_TARGETS : PERSONAL_FIELD_TARGETS;
    setCanonicalUtterance(nextTargets[0].canonicalUtterance);
  }

  function addPhrase() {
    const existing = [...profile.commandAliases, ...profile.fieldAliases];
    const error = validateDoctorVoiceAlias(phrase, existing);
    if (error) return setMessage(error);
    const alias: DoctorVoiceAlias = { phrase: phrase.trim(), canonicalUtterance };
    const next = { ...profile, [kind]: [...profile[kind], alias] };
    persist(next, `“${alias.phrase}” is now mapped to an existing protected DD intent on this browser.`);
    setPhrase("");
  }

  function removePhrase(alias: DoctorVoiceAlias, aliasKind: AliasKind) {
    const next = {
      ...profile,
      [aliasKind]: profile[aliasKind].filter((candidate) => candidate !== alias),
    };
    persist(next, `Removed “${alias.phrase}”.`);
  }

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <SectionCard className="overflow-hidden">
        <SectionHeader title="Preferred speaking style" icon={<Mic2 className="size-4" />} />
        <div className="p-4 sm:p-5">
          <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Preferred Voice language">
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={profile.language === option.value}
                onClick={() => persist({ ...profile, language: option.value }, `Preferred speaking style set to ${option.label}.`)}
                className={`min-h-10 rounded-xl border px-3 text-sm font-semibold focus-visible:focus-ring ${profile.language === option.value ? "border-brand bg-brand-soft text-brand" : "border-hairline bg-white text-ink-secondary"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            This preference and the aliases below stay in this browser in the current Preview. Provider configuration and the canonical runtime contract are unchanged.
          </p>
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Add a personal phrase" icon={<Plus className="size-4" />} />
        <div className="grid min-w-0 gap-3 p-4 sm:p-5 lg:grid-cols-[0.8fr_1fr_1.4fr_auto] lg:items-end">
          <label className="min-w-0 text-xs font-semibold text-ink-secondary">
            Alias type
            <select value={kind} onChange={(event) => changeKind(event.target.value as AliasKind)} className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink">
              <option value="commandAliases">Command</option>
              <option value="fieldAliases">Field terminology</option>
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold text-ink-secondary">
            Existing DD intent or field
            <select value={canonicalUtterance} onChange={(event) => setCanonicalUtterance(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink">
              {targets.map((target) => <option key={target.id} value={target.canonicalUtterance}>{target.label}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-semibold text-ink-secondary">
            Your exact spoken phrase
            <input value={phrase} onChange={(event) => setPhrase(event.target.value)} maxLength={80} placeholder="e.g. oshudh ta dao" className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink" />
          </label>
          <button type="button" onClick={addPhrase} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white focus-visible:focus-ring">
            <Plus className="size-4" /> Add phrase
          </button>
          <p className="text-xs text-ink-muted lg:col-span-4" aria-live="polite">{message}</p>
        </div>
      </SectionCard>

      <AliasList title="Active personal command phrases" aliases={profile.commandAliases} kind="commandAliases" onRemove={removePhrase} />
      <AliasList title="Active field terminology" aliases={profile.fieldAliases} kind="fieldAliases" onRemove={removePhrase} />

      <SectionCard className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#07684a]" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-ink">Safety remains canonical</h2>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              A personal phrase is only an exact alias for an existing DD intent. It still passes through normal context and safety validation, cannot save a medicine, confirm investigations, apply Autopilot, or finalize a prescription, and never writes directly to the database.
            </p>
            <p className="mt-2 text-xs leading-5 text-ink-muted">
              Passive learning is not enabled in this Preview. A future suggestion may be offered only after a reliable repeated-pattern signal, and it must still require your explicit Add phrase confirmation.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function emptySubscribe(): () => void {
  return () => undefined;
}

function AliasList({ title, aliases, kind, onRemove }: { title: string; aliases: readonly DoctorVoiceAlias[]; kind: AliasKind; onRemove: (alias: DoctorVoiceAlias, kind: AliasKind) => void }) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader title={title} count={aliases.length} icon={<Mic2 className="size-4" />} />
      {aliases.length === 0 ? <p className="p-5 text-sm text-ink-muted">No confirmed phrases yet.</p> : (
        <ul className="divide-y divide-hairline">
          {aliases.map((alias) => (
            <li key={`${alias.phrase}:${alias.canonicalUtterance}`} className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-ink">“{alias.phrase}”</p><p className="text-xs text-ink-muted">→ {alias.canonicalUtterance}</p></div>
              <button type="button" onClick={() => onRemove(alias, kind)} aria-label={`Remove ${alias.phrase}`} className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-[#a81c1c] focus-visible:focus-ring"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
