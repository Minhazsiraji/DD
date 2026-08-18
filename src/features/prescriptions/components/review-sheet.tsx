import * as React from "react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { PAPER_MM } from "@/features/doctor/schema";
import type { ReviewView } from "../review-view";

/**
 * The prescription, on paper.
 *
 * A true-proportion sheet: everything is sized from the paper's own width in
 * container-query units, so a 15 mm margin is 15 mm OF THIS PAPER whether it
 * renders on a phone or a desktop column. Sizing in fixed pixels would show the
 * doctor a layout that is not the one that prints.
 *
 * The container query trap this already hit once (Phase 2.6): `cqw` resolves
 * against the nearest ANCESTOR container, so the element declaring
 * `container-type` must not be the same element consuming `cqw`. Hence the
 * wrapper.
 *
 * Every value comes from the view model, which comes from the canonical bundle.
 * This component reads no database row and holds no state — it is what Stage
 * 7C-3 will print, so it must stay a pure function of the reviewed content.
 */
export function ReviewSheet({ view, className }: { view: ReviewView; className?: string }) {
  const paper = PAPER_MM[view.paperSize];
  const widthPt = (paper.w / 25.4) * 72;

  /** A share of the paper's width, so the whole sheet scales as one. */
  const mm = (v: number) => `${(v / paper.w) * 100}cqw`;
  const pt = (points: number) => `${(points / widthPt) * 100}cqw`;

  return (
    <div className={cn("@container w-full", className)}>
      <div
        data-review-sheet
        className="bg-white text-ink shadow-soft ring-1 ring-hairline"
        style={{
          aspectRatio: `${paper.w} / ${paper.h}`,
          padding: mm(view.marginMm),
          fontSize: pt(view.baseFontPt),
          lineHeight: 1.45,
        }}
      >
        {view.header ? (
          <header
            className="border-b border-ink/25"
            style={{ paddingBottom: mm(3), marginBottom: mm(4) }}
          >
            <div className="flex items-start justify-between" style={{ gap: mm(6) }}>
              <div className="min-w-0">
                <p className="font-semibold" style={{ fontSize: pt(view.baseFontPt * 1.35) }}>
                  {view.header.doctorName ?? "—"}
                </p>
                {view.header.credentials.length > 0 ? (
                  <p style={{ fontSize: pt(view.baseFontPt * 0.85) }}>
                    {view.header.credentials.join(", ")}
                  </p>
                ) : null}
                {view.header.bmdc ? (
                  <p style={{ fontSize: pt(view.baseFontPt * 0.85) }}>
                    BMDC Reg. {view.header.bmdc}
                  </p>
                ) : null}
              </div>

              <div className="min-w-0 text-right">
                {view.header.clinicName ? (
                  <p className="font-semibold" style={{ fontSize: pt(view.baseFontPt * 1.1) }}>
                    {view.header.clinicName}
                  </p>
                ) : null}
                {view.header.addressLine ? (
                  <p style={{ fontSize: pt(view.baseFontPt * 0.85) }}>{view.header.addressLine}</p>
                ) : null}
                {view.header.phone ? (
                  <p style={{ fontSize: pt(view.baseFontPt * 0.85) }}>{view.header.phone}</p>
                ) : null}
              </div>
            </div>

            {view.header.headerNote ? (
              <p
                className="whitespace-pre-wrap"
                style={{ fontSize: pt(view.baseFontPt * 0.85), marginTop: mm(2) }}
              >
                {view.header.headerNote}
              </p>
            ) : null}
          </header>
        ) : null}

        {/* Who this is for. Never abbreviated — a prescription on the wrong
            patient is the worst thing this screen can produce. */}
        <section
          className="flex flex-wrap items-baseline border-b border-ink/15"
          style={{ gap: `${mm(1)} ${mm(6)}`, paddingBottom: mm(2.5), marginBottom: mm(4) }}
        >
          <span className="font-semibold">{view.patient.fullName ?? "—"}</span>
          <span>{view.patient.ageSex}</span>
          {view.patient.patientNumber ? (
            <span className="font-mono" style={{ fontSize: pt(view.baseFontPt * 0.85) }}>
              {view.patient.patientNumber}
            </span>
          ) : null}
          {/*
            The prescription's date, and the same value the age was computed
            from. Printed so the paper says which day it speaks for — and so a
            reprint years later is obviously historical rather than current.
          */}
          <span className="ml-auto tabular-nums">{formatDate(view.clinicalDate)}</span>
        </section>

        <section>
          <p className="font-serif italic" style={{ fontSize: pt(view.baseFontPt * 1.6) }}>
            R<span style={{ fontSize: pt(view.baseFontPt) }}>x</span>
          </p>

          <ol style={{ marginTop: mm(2) }}>
            {view.lines.map((line) => (
              <li key={line.position} className="flex" style={{ gap: mm(3), marginTop: mm(3.5) }}>
                <span className="shrink-0 tabular-nums">{line.position}.</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {line.name}
                    {/* Strength sits beside the name, as it is written on a pad. */}
                    {line.strength ? <span className="font-normal"> {line.strength}</span> : null}
                    {line.isPrn ? (
                      <span className="font-normal italic"> (as needed)</span>
                    ) : null}
                  </p>

                  {line.subtitle ? (
                    <p style={{ fontSize: pt(view.baseFontPt * 0.85) }}>{line.subtitle}</p>
                  ) : null}

                  {/*
                    Dose, schedule, duration and food relation on one line, in
                    the order a pharmacist reads them. Dose is NEVER merged into
                    strength — "500 mg" is the product, "1 tablet" is the act.
                  */}
                  {[line.dose, line.schedule, line.duration, line.foodRelation].some(Boolean) ? (
                    <p>
                      {[line.dose, line.schedule, line.duration, line.foodRelation]
                        .filter(Boolean)
                        .join(" — ")}
                    </p>
                  ) : null}

                  {[line.administration, line.quantity].some(Boolean) ? (
                    <p style={{ fontSize: pt(view.baseFontPt * 0.85) }}>
                      {[line.administration, line.quantity].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}

                  {/* Long Bangla instructions must wrap, never clip. */}
                  {line.instructions ? (
                    <p className="break-words whitespace-pre-wrap">{line.instructions}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          {view.lines.length === 0 ? (
            <p className="italic" style={{ marginTop: mm(3) }}>
              No medicines on this prescription yet.
            </p>
          ) : null}
        </section>

        {view.signature.kind !== "hidden" ? (
          <section className="flex justify-end" style={{ marginTop: mm(10) }}>
            <div className="text-center">
              {/*
                7C-1 shows the signature BLOCK, never a signature image. The
                frozen object does not exist until Stage 7C-2A freezes it, and
                rendering the doctor's live profile signature here would show
                them something the bundle does not attest.
              */}
              <div
                className="border-t border-ink/40"
                style={{ width: mm(45), marginBottom: mm(1) }}
              />
              <p style={{ fontSize: pt(view.baseFontPt * 0.85) }}>
                {view.header?.doctorName ?? "Signature"}
              </p>
            </div>
          </section>
        ) : null}

        {view.showFooter && view.footerText ? (
          <footer
            className="border-t border-ink/15 whitespace-pre-wrap"
            style={{ marginTop: mm(6), paddingTop: mm(2), fontSize: pt(view.baseFontPt * 0.8) }}
          >
            {view.footerText}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
