"use client";

import * as React from "react";
import type { DocumentChrome } from "../review-view";
import type { Units } from "./prescription-parts";
import { usePrescriptionAssets } from "./prescription-asset-provider";

/** V4/V5 chamber-pad header. V5 replaces the reserved mark with the exact
 * clinic logo object attested by the bundle; v4 keeps the same blank slot. */
export function ClinicLogoHeader({
  view,
  u,
  clinicLogoUrl,
}: {
  view: DocumentChrome;
  u: Units;
  clinicLogoUrl?: string | null;
  /** Kept for the accepted V4 document call contract. V4 reserves the slot;
   * V5 fills that same slot when its immutable logo asset is available. */
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

        <div className="ml-auto flex min-w-0 items-start justify-end" style={{ gap: u.mm(2.5) }}>
          {showLogo ? (
            <span
              data-rx-clinic-logo-image
              role="img"
              aria-label={`${h.clinicName ?? "Clinic"} logo`}
              className="shrink-0"
              style={{
                width: u.mm(12),
                height: u.mm(12),
                backgroundImage: `url(${JSON.stringify(resolvedUrl).slice(1, -1)})`,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "contain",
              }}
            />
          ) : (
            <span
              data-rx-clinic-logo-slot="reserved"
              aria-hidden="true"
              className="shrink-0"
              style={{ width: u.mm(12), height: u.mm(12) }}
            />
          )}
          <div className="min-w-0 text-right">
            {h.clinicName ? (
              <p className="font-semibold" style={{ fontSize: u.pt(view.baseFontPt * 1.1) }}>
                {h.clinicName}
              </p>
            ) : null}
            {h.addressLine ? (
              <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>{h.addressLine}</p>
            ) : null}
            {h.phone ? <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>{h.phone}</p> : null}
          </div>
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
