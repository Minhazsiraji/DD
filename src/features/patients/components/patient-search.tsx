"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader } from "lucide-react";

export function PatientSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = React.useState(initialQuery);
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commit = React.useCallback(
    (next: string) => {
      const q = new URLSearchParams(params.toString());
      if (next.trim()) q.set("q", next.trim());
      else q.delete("q");
      startTransition(() => router.replace(`/patients?${q.toString()}`));
    },
    [params, router],
  );

  React.useEffect(() => {
    const delay = value.trim() === "" ? 0 : 250;
    const t = setTimeout(() => commit(value), delay);
    return () => clearTimeout(t);
  }, [value, commit]);

  return (
    <div className="liquid-patient-search relative rounded-full p-1">
      <label htmlFor="patient-search" className="sr-only">
        Search patients by name, phone or patient number
      </label>

      <Search
        className="pointer-events-none absolute top-1/2 left-4.5 size-[18px] -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />

      <input
        id="patient-search"
        ref={inputRef}
        type="search"
        inputMode="search"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Name, phone or patient number…"
        className="liquid-input h-12 w-full rounded-full pr-12 pl-11 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring"
      />

      {pending ? (
        <Loader
          className="absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin text-ink-muted"
          aria-hidden="true"
        />
      ) : value ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="liquid-icon-button absolute top-1/2 right-2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-transform hover:-translate-y-[52%] hover:text-brand focus-visible:focus-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
