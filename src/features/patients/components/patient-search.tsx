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
    <div className="relative max-w-3xl">
      <label htmlFor="patient-search" className="sr-only">
        Search patients by name, phone or patient number
      </label>

      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
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
        className="dd-input h-11 w-full rounded-full pr-11 pl-10 text-[13px] text-ink placeholder:text-ink-muted focus-visible:focus-ring"
      />

      {pending ? (
        <Loader
          className="absolute top-1/2 right-3.5 size-3.5 -translate-y-1/2 animate-spin text-ink-muted"
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
          className="dd-icon-btn absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted hover:text-brand focus-visible:focus-ring"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
