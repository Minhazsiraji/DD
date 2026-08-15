import * as React from "react";
import { cn } from "@/lib/utils";
import { PAPER_MM, type TemplateSettings } from "../schema";

/**
 * A true-proportion preview of the prescription paper.
 *
 * Everything scales from the paper's own width using container-query units, so
 * a 15 mm margin is 15 mm *of this paper* whether it renders in a phone-width
 * card or a desktop column. Sizing the preview in fixed pixels would show the
 * doctor a layout that is not the one that prints.
 *
 * IMPORTANT: the body is a labelled PLACEHOLDER. It shows where prescription
 * content will sit — it never shows invented medicines, doses or diagnoses. A
 * mock drug name on a page shaped like a real prescription is a page somebody
 * eventually prints.
 */

export interface PreviewDoctor {
  fullName: string;
  qualification: string | null;
  specialization: string | null;
  designation: string | null;
  bmdcRegistrationNo: string | null;
  signatureUrl: string | null;
}

export interface PreviewLocation {
  name: string;
  address: string | null;
  district: string | null;
  phone: string | null;
}

/** Points across the paper — 1pt = 1/72in, so this converts pt to a share of width. */
const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

export function PrescriptionPreview({
  template,
  doctor,
  location,
  className,
}: {
  template: TemplateSettings;
  doctor: PreviewDoctor;
  location: PreviewLocation | null;
  className?: string;
}) {
  const paper = PAPER_MM[template.paperSize];
  const widthPt = (paper.w / MM_PER_INCH) * PT_PER_INCH;

  /** A share of the paper's width, expressed in container-query units. */
  const cq = (mm: number) => `${(mm / paper.w) * 100}cqw`;
  const pt = (points: number) => `${(points / widthPt) * 100}cqw`;

  const clinicName = template.clinicNameOverride?.trim() || location?.name || "Your chamber";
  const addressLine = [location?.address, location?.district].filter(Boolean).join(", ");

  /**
   * The container declaration and the cqw consumers must be on DIFFERENT
   * elements. `cqw` resolves against the nearest ANCESTOR container, so putting
   * both on one box makes it fall back to the viewport — which sized 11pt text
   * as if the paper were as wide as the window.
   */
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border border-hairline bg-white text-ink shadow-soft",
        className,
      )}
      style={
        {
          aspectRatio: `${paper.w} / ${paper.h}`,
          containerType: "inline-size",
        } as React.CSSProperties
      }
      role="img"
      aria-label={`Preview of the ${template.name} prescription layout on ${template.paperSize} paper`}
    >
      <div
        className="flex h-full flex-col"
        style={{
          padding: cq(template.marginMm),
          fontSize: pt(template.baseFontPt),
          lineHeight: 1.45,
        }}
      >
        {template.showHeader ? (
          <header
            className="flex items-start justify-between gap-[2cqw] border-b border-ink/25 pb-[2cqw]"
            style={{ marginBottom: cq(6) }}
          >
            <div className="min-w-0">
              <p className="font-semibold leading-tight" style={{ fontSize: pt(template.baseFontPt * 1.35) }}>
                {doctor.fullName || "Your name"}
              </p>
              {template.showQualification && doctor.qualification ? (
                <p className="text-ink-secondary">{doctor.qualification}</p>
              ) : null}
              {template.showSpecialization && doctor.specialization ? (
                <p className="text-ink-secondary">{doctor.specialization}</p>
              ) : null}
              {template.showDesignation && doctor.designation ? (
                <p className="text-ink-secondary">{doctor.designation}</p>
              ) : null}
              {template.showBmdc && doctor.bmdcRegistrationNo ? (
                <p className="tabular-nums text-ink-secondary">
                  BMDC Reg. No. {doctor.bmdcRegistrationNo}
                </p>
              ) : null}
            </div>

            <div className="shrink-0 text-right">
              <div className="flex items-center justify-end gap-[1.5cqw]">
                {template.showClinicLogo ? (
                  <span
                    className="grid shrink-0 place-items-center rounded-sm border border-dashed border-ink/30 text-ink-muted"
                    style={{ width: cq(12), height: cq(12), fontSize: pt(template.baseFontPt * 0.6) }}
                    aria-hidden="true"
                  >
                    Logo
                  </span>
                ) : null}
                <p className="font-semibold leading-tight">{clinicName}</p>
              </div>
              {template.showChamberAddress && addressLine ? (
                <p className="text-ink-secondary">{addressLine}</p>
              ) : null}
              {template.showChamberPhone && location?.phone ? (
                <p className="tabular-nums text-ink-secondary">{location.phone}</p>
              ) : null}
            </div>
          </header>
        ) : (
          <div
            className="grid place-items-center rounded-sm border border-dashed border-ink/25 text-ink-muted"
            style={{ height: cq(28), marginBottom: cq(6), fontSize: pt(template.baseFontPt * 0.85) }}
          >
            Space left blank for your pre-printed letterhead
          </div>
        )}

        {template.headerNote ? (
          <p
            className="text-center text-ink-secondary"
            style={{ marginBottom: cq(4), fontSize: pt(template.baseFontPt * 0.85) }}
          >
            {template.headerNote}
          </p>
        ) : null}

        {/* Patient strip — labels only. No invented patient. */}
        <div
          className="flex flex-wrap items-baseline gap-x-[4cqw] gap-y-[1cqw] border-b border-ink/15 pb-[1.5cqw] text-ink-muted"
          style={{ marginBottom: cq(5), fontSize: pt(template.baseFontPt * 0.9) }}
        >
          <span>Name ————————</span>
          <span>Age ———</span>
          <span>Sex ———</span>
          <span>Date ————</span>
        </div>

        <div className="flex min-h-0 flex-1 gap-[3cqw]">
          <div
            className="shrink-0 font-semibold text-ink"
            style={{ fontSize: pt(template.baseFontPt * 2) }}
            aria-hidden="true"
          >
            ℞
          </div>
          <div className="grid flex-1 place-items-center rounded-sm border border-dashed border-ink/20">
            <p
              className="px-[3cqw] text-center text-ink-muted"
              style={{ fontSize: pt(template.baseFontPt * 0.9) }}
            >
              Prescription content will appear here.
              <br />
              Nothing is written yet — this is a layout preview.
            </p>
          </div>
        </div>

        {template.showSignature ? (
          <div className="mt-[4cqw] flex justify-end">
            <div className="text-center" style={{ width: cq(55) }}>
              {doctor.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL; next/image would cache it
                <img
                  src={doctor.signatureUrl}
                  alt=""
                  className="mx-auto object-contain"
                  // Width is capped so an unusually tall upload cannot push the
                  // signature out past the block it belongs in.
                  style={{ height: cq(14), maxWidth: "100%" }}
                />
              ) : (
                <div style={{ height: cq(14) }} aria-hidden="true" />
              )}
              <p className="border-t border-ink/40 pt-[1cqw]">
                {doctor.fullName || "Your name"}
              </p>
              {template.showBmdc && doctor.bmdcRegistrationNo ? (
                <p className="tabular-nums text-ink-secondary" style={{ fontSize: pt(template.baseFontPt * 0.8) }}>
                  BMDC {doctor.bmdcRegistrationNo}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {template.showFooter && template.footerText ? (
          <footer
            className="mt-[3cqw] border-t border-ink/15 pt-[1.5cqw] text-center text-ink-secondary"
            style={{ fontSize: pt(template.baseFontPt * 0.8) }}
          >
            {template.footerText}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
