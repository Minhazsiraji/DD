"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, X, Loader2, TriangleAlert, UserPlus, ExternalLink } from "lucide-react";
import { findPatientsAction, type FinderPatientResult } from "../finder-actions";
import { DoctorConsultationLauncher } from "./doctor-consultation-launcher";
import { formatAge } from "../identity";
import { SEX_LABEL } from "../schema";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 225;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

export function GlobalPatientFinder() {
  const pathname = usePathname();
  const router = useRouter();
  const desktopRef = React.useRef<HTMLInputElement>(null);
  const mobileRef = React.useRef<HTMLInputElement>(null);
  const requestSeq = React.useRef(0);
  const [term, setTerm] = React.useState("");
  const [patients, setPatients] = React.useState<FinderPatientResult[]>([]);
  const [canRegister, setCanRegister] = React.useState(false);
  const [operationalOnly, setOperationalOnly] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);

  const trimmed = term.trim();
  const showResults = trimmed.length >= 2;
  const selected = patients[selectedIndex] ?? null;

  function updateTerm(next: string) {
    setTerm(next);
    if (next.trim().length < 2) {
      requestSeq.current += 1;
      setPatients([]);
      setError(null);
      setLoading(false);
      setSelectedIndex(0);
      setCanRegister(false);
      setOperationalOnly(false);
    }
  }

  React.useEffect(() => {
    if (trimmed.length < 2) {
      requestSeq.current += 1;
      return;
    }

    const seq = ++requestSeq.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const result = await findPatientsAction(trimmed);
      if (seq !== requestSeq.current) return;
      setLoading(false);
      if (!result.ok) {
        setPatients([]);
        setCanRegister(false);
        setOperationalOnly(false);
        setError(result.message);
        setSelectedIndex(0);
        return;
      }
      setPatients(result.patients);
      setCanRegister(result.canRegister);
      setOperationalOnly(result.operationalOnly);
      setSelectedIndex(0);
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [trimmed, retryKey]);

  React.useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (pathname.startsWith("/consultation/")) return;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (window.matchMedia("(min-width: 640px)").matches) {
        desktopRef.current?.focus();
      } else {
        setMobileOpen(true);
        window.setTimeout(() => mobileRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [pathname]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(0, patients.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      router.push(`/patients/${selected.id}`);
      setMobileOpen(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      updateTerm("");
      setMobileOpen(false);
    }
  }, [patients.length, router, selected, showResults]);

  const refreshCurrentSearch = React.useCallback(() => setRetryKey((key) => key + 1), []);

  const inputProps = (id: string) => ({
    id,
    role: "combobox" as const,
    "aria-autocomplete": "list" as const,
    "aria-expanded": showResults,
    "aria-controls": `${id}-listbox`,
    "aria-activedescendant": selected ? `${id}-option-${selected.id}` : undefined,
    value: term,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => updateTerm(event.target.value),
    onKeyDown: handleKeyDown,
    autoComplete: "off",
    inputMode: "search" as const,
  });

  return (
    <>
      <div className="relative hidden min-w-0 flex-1 sm:block">
        <label htmlFor="global-patient-finder" className="sr-only">
          Find patients by name, phone or patient number
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          ref={desktopRef}
          type="search"
          placeholder="Find patient…  /"
          className="dd-input h-10 min-w-0 w-full rounded-xl border border-hairline bg-white/80 pr-10 pl-9 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring sm:max-w-xl"
          {...inputProps("global-patient-finder")}
        />
        <InputTail loading={loading} term={term} onClear={() => updateTerm("")} />
        {showResults ? (
          <FinderPanel
            id="global-patient-finder"
            term={trimmed}
            patients={patients}
            selectedIndex={selectedIndex}
            setSelectedIndex={setSelectedIndex}
            selected={selected}
            loading={loading}
            error={error}
            canRegister={canRegister}
            operationalOnly={operationalOnly}
            onRetry={() => setRetryKey((key) => key + 1)}
            onContextChanged={refreshCurrentSearch}
            className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(680px,calc(100vw-2rem))]"
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => {
          setMobileOpen(true);
          window.setTimeout(() => mobileRef.current?.focus(), 0);
        }}
        aria-label="Find patient"
        className="dd-icon-btn inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-hairline bg-white/80 text-ink-secondary focus-visible:focus-ring sm:hidden"
      >
        <Search className="size-4" aria-hidden="true" />
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[90] bg-[#211b4a]/20 p-2 backdrop-blur-sm sm:hidden" role="dialog" aria-modal="true" aria-label="Find patient">
          <div className="dd-app-panel mx-auto flex h-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white/90 p-3 shadow-2xl">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <label htmlFor="mobile-patient-finder" className="sr-only">Find patient</label>
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                <input
                  ref={mobileRef}
                  type="search"
                  placeholder="Name, phone or patient number…"
                  className="dd-input h-12 w-full rounded-xl border border-hairline bg-white pr-10 pl-9 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring"
                  {...inputProps("mobile-patient-finder")}
                />
                <InputTail loading={loading} term={term} onClear={() => updateTerm("")} />
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-hairline bg-white text-ink-secondary focus-visible:focus-ring"
                aria-label="Close patient finder"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {showResults ? (
                <FinderPanel
                  id="mobile-patient-finder"
                  term={trimmed}
                  patients={patients}
                  selectedIndex={selectedIndex}
                  setSelectedIndex={setSelectedIndex}
                  selected={selected}
                  loading={loading}
                  error={error}
                  canRegister={canRegister}
                  operationalOnly={operationalOnly}
                  onRetry={() => setRetryKey((key) => key + 1)}
                  onContextChanged={refreshCurrentSearch}
                />
              ) : (
                <p className="px-2 py-6 text-center text-sm text-ink-secondary">Type at least 2 characters to search.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function InputTail({ loading, term, onClear }: { loading: boolean; term: string; onClear: () => void }) {
  if (loading) return <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-muted" aria-hidden="true" />;
  if (!term) return null;
  return (
    <button type="button" onClick={onClear} aria-label="Clear patient search" className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted focus-visible:focus-ring">
      <X className="size-4" aria-hidden="true" />
    </button>
  );
}

function FinderPanel({
  id,
  term,
  patients,
  selectedIndex,
  setSelectedIndex,
  selected,
  loading,
  error,
  canRegister,
  operationalOnly,
  onRetry,
  onContextChanged,
  className,
}: {
  id: string;
  term: string;
  patients: FinderPatientResult[];
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  selected: FinderPatientResult | null;
  loading: boolean;
  error: string | null;
  canRegister: boolean;
  operationalOnly: boolean;
  onRetry: () => void;
  onContextChanged: () => void;
  className?: string;
}) {
  return (
    <div className={cn("dd-app-panel overflow-hidden rounded-2xl border border-hairline bg-white/95 shadow-xl", className)}>
      {error ? (
        <div className="p-4">
          <p className="flex items-start gap-2 text-[13px] font-semibold text-danger">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            Patient search is temporarily unavailable.
          </p>
          <p className="mt-1 text-xs text-ink-muted">This is not the same as “no patient found”. Registration is disabled until search works again.</p>
          <button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">Retry</button>
        </div>
      ) : patients.length > 0 ? (
        <>
          <ul id={`${id}-listbox`} role="listbox" aria-label="Patient suggestions" className="max-h-72 overflow-y-auto divide-y divide-hairline">
            {patients.map((patient, index) => (
              <li
                key={patient.id}
                id={`${id}-option-${patient.id}`}
                role="option"
                aria-selected={index === selectedIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setSelectedIndex(index)}
                className={cn("cursor-pointer px-3.5 py-3 outline-none", index === selectedIndex ? "bg-brand-soft/65" : "hover:bg-white/60")}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{patient.fullName}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-secondary">
                      <span className="font-mono text-ink-muted">{patient.patientNumber}</span>
                      <span>{formatAge({ years: patient.ageYears, isApproximate: patient.ageApproximate })}</span>
                      <span>{SEX_LABEL[patient.sex as keyof typeof SEX_LABEL] ?? patient.sex}</span>
                    </p>
                    {patient.phone ? <p className="mt-0.5 text-xs tabular-nums text-ink-muted">{patient.phone}</p> : null}
                  </div>
                  <StateChip state={patient.contextState} allergyCount={patient.allergyCount} />
                </div>
              </li>
            ))}
          </ul>
          {selected ? (
            <div className="border-t border-hairline p-3.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Link href={`/patients/${selected.id}`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Open patient
                </Link>
                {selected.canClinical && !operationalOnly ? (
                  <div className="min-w-0 flex-1">
                    <DoctorConsultationLauncher
                      patientId={selected.id}
                      patientName={selected.fullName}
                      patientNumber={selected.patientNumber}
                      state={selected.contextState}
                      appointmentId={selected.appointmentId}
                      tokenNumber={selected.tokenNumber}
                      locationName={selected.locationName}
                      canMarkArrived={selected.canMarkArrived}
                      compact
                      onChanged={onContextChanged}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : !loading ? (
        <div className="p-4">
          <p className="text-sm font-semibold text-ink">No patient matches “{term}”</p>
          <p className="mt-1 text-xs text-ink-muted">Check the spelling, phone number or patient number.</p>
          {canRegister ? (
            <Link href={`/patients/new?name=${encodeURIComponent(term)}`} className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft focus-visible:focus-ring">
              <UserPlus className="size-4" aria-hidden="true" />
              Register “{term}”
            </Link>
          ) : operationalOnly ? (
            <p className="mt-3 text-xs text-ink-secondary">Use Appointments to add a walk-in through the authorised desk workflow.</p>
          ) : null}
        </div>
      ) : (
        <p className="p-4 text-sm text-ink-secondary">Searching…</p>
      )}
    </div>
  );
}

function StateChip({ state, allergyCount }: { state: FinderPatientResult["contextState"]; allergyCount: number }) {
  const label = state === "IN_CONSULTATION" ? "In consultation" : state === "ARRIVED" ? "Arrived" : state === "CONFIRMED" ? "Confirmed" : state === "SCHEDULED" ? "Scheduled" : state === "COMPLETED" ? "Seen today" : null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {label ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-semibold text-brand">{label}</span> : null}
      {allergyCount > 0 ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10.5px] font-semibold text-danger">Allergy</span> : null}
    </div>
  );
}
