import * as React from "react";
import type { DocumentChrome } from "../review-view";
import type { Units } from "./prescription-parts";

/** V4/V5 chamber-pad header. V5 may replace the reserved mark with the exact
 * clinic logo object attested by the bundle; v4 keeps the same blank slot. */
export function ClinicLogoHeader({
  view,
  u,
  clinicLogoUrl,
}: {
  view: DocumentChrome;
  u: Units;
  clinicLogoUrl?: string | null;
}) {
  if (!view.header) return null;
  const h = view.header;
  const showLogo = view.clinicLogo.kind === "frozen" && Boolean(clinicLogoUrl);

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
            // eslint-disable-next-line @next/next/no-img-element -- private signed asset URL
            <img
              data-rx-clinic-logo-image
              src={clinicLogoUrl ?? undefined}
              alt={`${h.clinicName ?? "Clinic"} logo`}
              className="shrink-0 object-contain"
              style={{ width: u.mm(12), height: u.mm(12) }}
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
