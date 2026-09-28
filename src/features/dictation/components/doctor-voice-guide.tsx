"use client";

import * as React from "react";
import { AudioLines, Search, ShieldCheck } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { cn } from "@/lib/utils";
import {
  aliasesForGuideLanguage,
  valueExampleForGuide,
  type VoiceGuideControl,
  type VoiceGuideLanguage,
} from "../m6f-voice-guide";
import type { VoiceSurfaceEntry } from "../m6f-voice-surface-inventory";

const LANGUAGES: readonly { id: VoiceGuideLanguage; label: string }[] = [
  { id: "english", label: "English" },
  { id: "bangla", label: "বাংলা" },
  { id: "banglish", label: "Banglish" },
];

const GROUPS = [
  { id: "consultation", label: "Consultation" },
  { id: "prescription", label: "Prescription & medicines" },
] as const;

interface DoctorVoiceGuideProps {
  entries: readonly VoiceSurfaceEntry[];
  controls: readonly VoiceGuideControl[];
  safety: readonly { title: string; description: string }[];
}

export function DoctorVoiceGuide({ entries, controls, safety }: DoctorVoiceGuideProps) {
  const [language, setLanguage] = React.useState<VoiceGuideLanguage>("english");
  const [query, setQuery] = React.useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");

  const filtered = React.useMemo(() => {
    if (!normalizedQuery) return entries;
    return entries.filter((entry) => {
      const aliases = aliasesForGuideLanguage(entry, language);
      return [entry.uiLabel, entry.section, entry.sourceKey, ...aliases]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery);
    });
  }, [entries, language, normalizedQuery]);

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <SectionCard className="overflow-hidden">
        <SectionHeader
          title="Find a target or command"
          icon={<Search className="size-4" />}
          action={
            <div className="flex min-w-0 flex-wrap gap-1 rounded-xl bg-surface-muted p-1" role="tablist" aria-label="Voice guide language">
              {LANGUAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={language === item.id}
                  onClick={() => setLanguage(item.id)}
                  className={cn(
                    "min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:focus-ring",
                    language === item.id ? "bg-white text-brand shadow-soft" : "text-ink-secondary hover:text-ink",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          }
        />
        <div className="p-4 sm:p-5">
          <label className="relative block min-w-0">
            <span className="sr-only">Search Voice Guide</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search targets, fields or spoken phrases"
              className="h-11 w-full min-w-0 rounded-xl border border-hairline bg-white pr-3 pl-10 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:focus-ring"
            />
          </label>
          <p className="mt-2 text-xs text-ink-muted" aria-live="polite">
            {filtered.length} of {entries.length} supported surfaces shown
          </p>
        </div>
      </SectionCard>

      {GROUPS.map((group) => {
        const groupEntries = filtered.filter((entry) => entry.page === group.id);
        if (groupEntries.length === 0) return null;
        const sections = [...new Set(groupEntries.map((entry) => entry.section))];
        return (
          <SectionCard key={group.id} className="overflow-hidden">
            <SectionHeader title={group.label} count={groupEntries.length} icon={<AudioLines className="size-4" />} />
            <div className="space-y-5 p-4 sm:p-5">
              {sections.map((section) => (
                <section key={section} aria-labelledby={`${group.id}-${section.replaceAll(" ", "-")}`}>
                  <h3 id={`${group.id}-${section.replaceAll(" ", "-")}`} className="mb-2 text-xs font-semibold tracking-wide text-ink-secondary uppercase">
                    {section}
                  </h3>
                  <div className="grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {groupEntries.filter((entry) => entry.section === section).map((entry) => (
                      <TargetCard key={entry.canonicalId} entry={entry} language={language} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </SectionCard>
        );
      })}

      {filtered.length === 0 ? (
        <SectionCard className="p-8 text-center">
          <p className="text-sm font-semibold text-ink">No supported Voice surface matches this search.</p>
          <p className="mt-1 text-xs text-ink-muted">Try a field name such as BP, Assessment, Dose or Investigation.</p>
        </SectionCard>
      ) : null}

      <SectionCard className="overflow-hidden">
        <SectionHeader title="General controls" icon={<AudioLines className="size-4" />} />
        <div className="grid min-w-0 gap-2 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
          {controls.map((control) => (
            <article key={control.id} className="min-w-0 rounded-xl border border-hairline bg-white/70 p-3">
              <h3 className="text-sm font-semibold text-ink">{control.label}</h3>
              <p className="mt-2 break-words rounded-lg bg-brand-soft px-2.5 py-2 text-[13px] font-medium text-brand">
                “{control.examples[language]}”
              </p>
              <p className="mt-2 text-xs leading-5 text-ink-secondary">{control.note}</p>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Doctor-controlled safety boundaries" icon={<ShieldCheck className="size-4" />} />
        <div className="grid min-w-0 gap-3 p-4 sm:p-5 lg:grid-cols-2">
          {safety.map((item) => (
            <article key={item.title} className="min-w-0 rounded-xl bg-success-soft p-3.5">
              <h3 className="text-sm font-semibold text-[#07684a]">{item.title}</h3>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">{item.description}</p>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function TargetCard({ entry, language }: { entry: VoiceSurfaceEntry; language: VoiceGuideLanguage }) {
  const examples = aliasesForGuideLanguage(entry, language);
  const valueExample = valueExampleForGuide(entry, language);
  return (
    <article className="min-w-0 rounded-xl border border-hairline bg-white/70 p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h4 className="min-w-0 break-words text-sm font-semibold text-ink">{entry.uiLabel}</h4>
        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-ink-muted uppercase">
          {entry.controlType}
        </span>
      </div>
      <p className="mt-2 break-words text-[13px] font-medium text-brand">“{examples[0] ?? entry.uiLabel}”</p>
      {examples.length > 1 ? (
        <p className="mt-1 break-words text-xs text-ink-muted">Also: {examples.slice(1, 3).join(" · ")}</p>
      ) : null}
      {valueExample ? <p className="mt-2 text-xs leading-5 text-ink-secondary">{valueExample}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold text-ink-secondary">
        {entry.editable ? <Tag>Dictate value</Tag> : null}
        {entry.clearable ? <Tag>Clear</Tag> : null}
        {entry.replaceable ? <Tag>Replace</Tag> : null}
        {entry.readable ? <Tag>Read</Tag> : null}
        {entry.nextPreviousEligible ? <Tag>Next/Previous</Tag> : null}
      </div>
      {entry.existingProtectedAction ? (
        <p className="mt-2 text-[11px] leading-4 text-[#8a3f07]">Protected: {entry.existingProtectedAction}</p>
      ) : null}
    </article>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-surface-muted px-2 py-1">{children}</span>;
}
