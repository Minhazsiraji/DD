"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlert, Loader2 } from "lucide-react";
import { frozenClinicLogoUrlAction } from "../asset-actions";

type LogoState =
  | { key: null; status: "ready"; url: null }
  | { key: string; status: "loading"; url: null }
  | { key: string; status: "ready"; url: string }
  | { key: string; status: "error"; url: null };

interface AssetContextValue {
  logo: LogoState;
  requireClinicLogo: (key: string | null) => void;
}

const AssetContext = React.createContext<AssetContextValue | null>(null);

export function usePrescriptionAssets() {
  return React.useContext(AssetContext);
}

/**
 * Loads the immutable clinic-logo object before any prescription UI that can
 * approve or print it becomes usable. The browser never supplies the storage
 * path to the server action; `key` is only a client cache key and the database
 * resolves the authoritative path from the prescription id.
 */
export function PrescriptionAssetProvider({
  prescriptionId,
  initialClinicLogoKey,
  children,
}: {
  prescriptionId: string;
  initialClinicLogoKey: string | null;
  children: React.ReactNode;
}) {
  const [logo, setLogo] = React.useState<LogoState>(
    initialClinicLogoKey
      ? { key: initialClinicLogoKey, status: "loading", url: null }
      : { key: null, status: "ready", url: null },
  );

  const requestKey = React.useCallback((key: string | null) => {
    setLogo((current) => {
      if (key === null) return current.key === null ? current : { key: null, status: "ready", url: null };
      if (current.key === key) return current;
      return { key, status: "loading", url: null };
    });
  }, []);

  React.useEffect(() => {
    if (logo.key === null || logo.status !== "loading") return;
    let cancelled = false;
    const key = logo.key;

    void frozenClinicLogoUrlAction(prescriptionId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLogo((current) =>
          current.key === key ? { key, status: "error", url: null } : current,
        );
        return;
      }

      // Preload before exposing children. A print action must not race a logo
      // network request and produce paper with a blank approved logo slot.
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        const settle = image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
        void settle.then(() => {
          if (!cancelled) {
            setLogo((current) =>
              current.key === key ? { key, status: "ready", url: result.url } : current,
            );
          }
        });
      };
      image.onerror = () => {
        if (!cancelled) {
          setLogo((current) =>
            current.key === key ? { key, status: "error", url: null } : current,
          );
        }
      };
      image.src = result.url;
    });

    return () => {
      cancelled = true;
    };
  }, [logo, prescriptionId]);

  const value = React.useMemo<AssetContextValue>(
    () => ({ logo, requireClinicLogo: requestKey }),
    [logo, requestKey],
  );

  if (logo.status === "loading") {
    return (
      <div className="mx-auto flex max-w-md items-center justify-center gap-2 py-16 text-[13px] text-ink-secondary" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading the clinic logo fixed to this prescription…
      </div>
    );
  }

  if (logo.status === "error") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <CircleAlert className="mx-auto size-8 text-danger" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold text-ink">Clinic logo could not be loaded</h2>
        <p className="mt-2 text-[13px] text-ink-secondary">
          The prescription is not shown or printable without the exact logo it attests. Reload in a moment.
          For a draft, you can also check the clinic logo in Prescription Settings.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => setLogo({ key: logo.key, status: "loading", url: null })}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-[13px] font-semibold text-white"
          >
            Try again
          </button>
          <Link
            href="/settings/prescription"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink"
          >
            Prescription settings
          </Link>
        </div>
      </div>
    );
  }

  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}
