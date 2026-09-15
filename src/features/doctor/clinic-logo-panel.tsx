"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { removeClinicLogoAction, uploadClinicLogoAction } from "./clinic-logo-actions";

export interface ClinicLogoSetting {
  locationId: string;
  locationName: string;
  logoUrl: string | null;
}

export function ClinicLogoPanel({ locations }: { locations: ClinicLogoSetting[] }) {
  if (locations.length === 0) return null;

  return (
    <section className="clinical-surface rounded-glass p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink">Clinic / chamber logo</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Upload the logo used at each place. Turn on “Clinic / chamber logo” in a prescription
          template to print it beside the chamber name. Each prescription stores the exact logo
          asset it was approved with, so replacing this image later cannot change an older signed prescription.
        </p>
      </div>

      <div className="divide-y divide-hairline">
        {locations.map((location) => (
          <ClinicLogoRow key={location.locationId} location={location} />
        ))}
      </div>
    </section>
  );
}

function ClinicLogoRow({ location }: { location: ClinicLogoSetting }) {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function upload(formData: FormData) {
    setMessage(null);
    startTransition(async () => {
      const result = await uploadClinicLogoAction(location.locationId, formData);
      setMessage({ ok: result.ok, text: result.message ?? (result.ok ? "Logo saved." : "Could not save the logo.") });
      if (result.ok) {
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  }

  function remove() {
    setMessage(null);
    startTransition(async () => {
      const result = await removeClinicLogoAction(location.locationId);
      setMessage({ ok: result.ok, text: result.message ?? (result.ok ? "Logo removed." : "Could not remove the logo.") });
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-hairline bg-white">
        {location.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- private expiring storage URL
          <img src={location.logoUrl} alt={`${location.locationName} logo`} className="size-full object-contain p-1" />
        ) : (
          <ImageIcon className="size-6 text-ink-muted" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{location.locationName}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {location.logoUrl ? "Logo uploaded" : "No logo uploaded yet"} · PNG, JPG or WebP · max 2 MB
        </p>
        {message ? (
          <p className={`mt-1 text-xs font-medium ${message.ok ? "text-[#07684a]" : "text-[#a81c1c]"}`} role="status">
            {message.text}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <form action={upload}>
          <input
            ref={inputRef}
            type="file"
            name="clinicLogo"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            id={`clinic-logo-${location.locationId}`}
            disabled={busy}
            onChange={(event) => {
              if (event.currentTarget.files?.length) event.currentTarget.form?.requestSubmit();
            }}
          />
          <label
            htmlFor={`clinic-logo-${location.locationId}`}
            aria-disabled={busy}
            className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted aria-disabled:pointer-events-none aria-disabled:opacity-55"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Upload className="size-3.5" aria-hidden="true" />}
            {location.logoUrl ? "Replace" : "Upload"}
          </label>
        </form>

        {location.logoUrl ? (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
