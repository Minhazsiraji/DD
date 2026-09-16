"use client";

import * as React from "react";
import type { DocumentChrome } from "../review-view";
import type { Units } from "./prescription-parts";
import { usePrescriptionAssets } from "./prescription-asset-provider";

/** V4/V5 chamber-pad header. V5 renders the exact clinic logo object attested
 * by the bundle beside the clinic name; a logo-free prescription has no slot. */
export function ClinicLogoHeader({
  view,
  u,
  clinicLogoUrl,
}: {
  view: DocumentChrome;
  u: Units;
  clinicLogoUrl?: string | null;
  /** Kept for the accepted V4 document call contract. */
  reserveClinicLogoSlot?: boolean;
}) {
  const assets = usePrescriptionAssets();
  const logoKey = view.clinicLogo.kind === "frozen" ? view.clinicLogo.path : null;
  const requireClinicLogo = assets?.requireClinicLogo;

  // Layout effect closes the one-frame gap when a doctor switches from a
  // logo-free template to a logo template: the provider blocks before paint.
  React.useLayoutEffect(() => {
    requireClinicLogo?.(logoKey);
  }, [requireClinicLogo, logoKey]);

  if (!view.header) return null;
  const h = view.header;
  const resolvedUrl = clinicLogoUrl ?? (assets?.logo.status === "ready" ? assets.logo.url : null);
  const showLogo = view.clinicLogo.kind === "frozen" && Boolean(resolvedUrl);

  return (
    <header
      className="border-b border-ink/25"
      style={{ paddingBottom: u.mm(3), marginBottom: u.mm(4) }}
    >
      <div className="flex items-start justify-between" style={{ gap: u.mm(6) }}>
        <div className="min-w-0">
          <p className="font-semibold" style={{ fontSize: u.pt(view.baseFontPt * 1.35) }}>
            {h.doctorName ?? "—"}
          </p>
          {h.credentials.length > 0 ? (
            <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>{h.credentials.join(", ")}</p>
          ) : null}
          {h.bmdc ? (
            <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>BMDC Reg. {h.bmdc}</p>
          ) : null}
        </div>

        <div className="ml-auto min-w-0 text-right">
          {showLogo || h.clinicName ? (
            <div
              className="flex min-w-0 flex-nowrap items-center justify-end"
              style={{ gap: showLogo && h.clinicName ? u.mm(2) : 0 }}
            >
              {showLogo ? (
                // The clinic logo is a short-lived signed private-Storage URL.
                // Use a real image element rather than CSS background-image so
                // Review, finalized display and native A4 print all paint the
                // exact attested asset without depending on "background graphics".
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  data-rx-clinic-logo-image
                  src={resolvedUrl ?? undefined}
                  alt={`${h.clinicName ?? "Clinic"} logo`}
                  className="shrink-0 object-contain"
                  style={{ width: u.mm(12), height: u.mm(12) }}
                />
              ) : null}
              {h.clinicName ? (
                <p
                  className="min-w-0 font-semibold"
                  style={{ fontSize: u.pt(view.baseFontPt * 1.1) }}
                >
                  {h.clinicName}
                </p>
              ) : null}
            </div>
          ) : null}
          {h.addressLine ? (
            <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>{h.addressLine}</p>
          ) : null}
          {h.phone ? <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>{h.phone}</p> : null}
        </div>
      </div>

      {h.headerNote ? (
        <p
          className="whitespace-pre-wrap"
          style={{ fontSize: u.pt(view.baseFontPt * 0.85), marginTop: u.mm(2) }}
        >
          {h.headerNote}
        </p>
      ) : null}
    </header>
  );
}
