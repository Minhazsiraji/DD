import * as React from "react";
import { formatDate } from "@/lib/format";
import type { ReviewLine, ReviewView } from "../review-view";

/**
 * The prescription document, once — rendered in two unit systems.
 *
 * The screen preview sizes everything from the paper's own width in
 * container-query units, so a 15 mm margin is 15 mm OF THAT PAPER at any
 * column width. Print sizes everything in real millimetres, because paper is
 * actually that size. Those are different LAYOUT problems and they need
 * different units.
 *
 * They are not different DOCUMENTS. Every clinical mark — the medicine name,
 * the strength, the dose, the schedule, the quantity, the instruction — is
 * emitted by the components below and nowhere else. If the two sheets each had
 * their own copy of this markup, the failure would be silent and specific:
 * print quietly missing `quantity` while the screen shows it, on paper a
 * pharmacist reads and the doctor never sees again.
 *
 * So the rule is enforced structurally rather than remembered:
 *
 *     DIFFERENT LAYOUT ENGINE, SAME CLINICAL DOCUMENT.
 *
 * `prescription-renderers.test.ts` asserts that neither sheet reads a clinical
 * field for itself.
 */

/**
 * How to express a length. `mm` is a physical millimetre of paper; `pt` a
 * typographic point. Screen converts both into shares of the paper's width;
 * print emits them literally.
 */
export interface Units {
  mm: (millimetres: number) => string;
  pt: (points: number) => string;
}

/** Real paper. Used by the print renderer, where a millimetre is a millimetre. */
export const PHYSICAL_UNITS: Units = {
  mm: (v) => `${v}mm`,
  pt: (v) => `${v}pt`,
};

/**
 * Proportional paper, for the on-screen preview.
 *
 * `cqw` resolves against the nearest ANCESTOR container, so the element
 * declaring `container-type` must not be the one consuming `cqw` — the A4
 * preview hit exactly that and sized its text as if the paper were as wide as
 * the window. The caller owns that split; this only does the arithmetic.
 */
export function proportionalUnits(paperWidthMm: number): Units {
  const widthPt = (paperWidthMm / 25.4) * 72;
  return {
    mm: (v) => `${(v / paperWidthMm) * 100}cqw`,
    pt: (v) => `${(v / widthPt) * 100}cqw`,
  };
}

export function PrescriptionHeader({ view, u }: { view: ReviewView; u: Units }) {
  if (!view.header) return null;
  const h = view.header;

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

/**
 * Who this is for.
 *
 * Never abbreviated and never truncated: a prescription on the wrong patient is
 * the worst thing this document can be.
 */
export function PatientIdentity({ view, u }: { view: ReviewView; u: Units }) {
  return (
    <section
      className="flex flex-wrap items-baseline border-b border-ink/15"
      style={{ gap: `${u.mm(1)} ${u.mm(6)}`, paddingBottom: u.mm(2.5), marginBottom: u.mm(4) }}
    >
      <span className="font-semibold">{view.patient.fullName ?? "—"}</span>
      <span>{view.patient.ageSex}</span>
      {view.patient.patientNumber ? (
        <span className="font-mono" style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>
          {view.patient.patientNumber}
        </span>
      ) : null}
      {/*
        The prescription's own date — the same value the printed age was
        computed from. On paper it says which day this speaks for, so a reprint
        years later is obviously historical rather than current.
      */}
      <span className="ml-auto tabular-nums">{formatDate(view.clinicalDate)}</span>
    </section>
  );
}

/**
 * One medicine.
 *
 * `break-inside: avoid` matters on paper and costs nothing on screen: a dose
 * split across a page break is how a patient reads half an instruction.
 */
export function MedicineLine({
  line,
  view,
  u,
}: {
  line: ReviewLine;
  view: ReviewView;
  u: Units;
}) {
  const dosing = [line.dose, line.schedule, line.duration, line.foodRelation].filter(Boolean);
  const supply = [line.administration, line.quantity].filter(Boolean);

  return (
    <li
      className="flex"
      style={{ gap: u.mm(3), marginTop: u.mm(3.5), breakInside: "avoid", pageBreakInside: "avoid" }}
    >
      <span className="shrink-0 tabular-nums">{line.position}.</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {line.name}
          {/* Strength sits beside the name, as it is written on a pad. */}
          {line.strength ? <span className="font-normal"> {line.strength}</span> : null}
          {line.isPrn ? <span className="font-normal italic"> (as needed)</span> : null}
        </p>

        {line.subtitle ? (
          <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>{line.subtitle}</p>
        ) : null}

        {/*
          Dose, schedule, duration and food relation on one line, in the order a
          pharmacist reads them. Dose is NEVER merged into strength — "500 mg"
          is the product, "1 tablet" is the act.
        */}
        {dosing.length > 0 ? <p>{dosing.join(" — ")}</p> : null}

        {supply.length > 0 ? (
          <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>{supply.join(" · ")}</p>
        ) : null}

        {/* Long Bangla instructions wrap. They are never clipped and never shrunk. */}
        {line.instructions ? (
          <p className="break-words whitespace-pre-wrap">{line.instructions}</p>
        ) : null}
      </div>
    </li>
  );
}

/** The medicines. The clinical body below is what absorbs a short page's slack. */
export function MedicineList({ view, u }: { view: ReviewView; u: Units }) {
  return (
    <section>
      <p className="font-serif italic" style={{ fontSize: u.pt(view.baseFontPt * 1.6) }}>
        R<span style={{ fontSize: u.pt(view.baseFontPt) }}>x</span>
      </p>

      <ol style={{ marginTop: u.mm(2) }}>
        {view.lines.map((line) => (
          <MedicineLine key={line.position} line={line} view={view} u={u} />
        ))}
      </ol>

      {view.lines.length === 0 ? (
        <p className="italic" style={{ marginTop: u.mm(3) }}>
          No medicines on this prescription yet.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Investigations ORDERED TODAY.
 *
 * Requests, not results. Doctor's Diary has no results module and this section
 * must never read like one — so there is no status column, no value, no date
 * and no tick. The heading says "Investigations / Tests" and the lines say
 * what was asked for, which is exactly what the patient carries to the lab.
 *
 * Omitted ENTIRELY when there are none: an empty heading on a prescription
 * invites the reader to wonder what is missing.
 */
export function InvestigationList({ view, u }: { view: ReviewView; u: Units }) {
  if (view.investigations.length === 0) return null;

  return (
    <section style={{ marginTop: u.mm(5), breakInside: "avoid", pageBreakInside: "avoid" }}>
      <p className="font-semibold" style={{ fontSize: u.pt(view.baseFontPt * 0.95) }}>
        Investigations / Tests
      </p>
      <ul style={{ marginTop: u.mm(1.5) }}>
        {view.investigations.map((x) => (
          <li
            key={x.position}
            className="flex"
            style={{ gap: u.mm(2), marginTop: u.mm(1), breakInside: "avoid" }}
          >
            <span aria-hidden="true">•</span>
            <span className="min-w-0 flex-1 break-words">
              {x.name}
              {/* The reason it was ordered — never a finding. */}
              {x.note ? <span className="italic"> — {x.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Today's advice, exactly as the doctor typed it.
 *
 * One line per line they wrote: doctors type advice as a list and a paragraph
 * that runs it together is harder for a patient to follow. Bangla and every
 * other script pass through untouched — `break-words` and `whitespace-pre-wrap`
 * wrap them, and nothing is ever clipped or shrunk to fit.
 */
export function AdviceBlock({ view, u }: { view: ReviewView; u: Units }) {
  if (!view.advice) return null;

  const lines = view.advice
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

  return (
    <section style={{ marginTop: u.mm(5), breakInside: "avoid", pageBreakInside: "avoid" }}>
      <p className="font-semibold" style={{ fontSize: u.pt(view.baseFontPt * 0.95) }}>
        Advice
      </p>
      <ul style={{ marginTop: u.mm(1.5) }}>
        {lines.map((line, i) => (
          <li
            key={i}
            className="flex"
            style={{ gap: u.mm(2), marginTop: u.mm(1), breakInside: "avoid" }}
          >
            <span aria-hidden="true">•</span>
            <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The signature block.
 *
 * `signatureUrl` is a short-lived URL for the object the bundle attests —
 * never the doctor's live profile signature, which the digest says nothing
 * about and which can change tomorrow.
 *
 * On screen, a missing image draws an empty rule: honest about a prescription
 * that is not signed yet. On paper that must never happen, which is why the
 * print path refuses to print at all unless the frozen image has loaded.
 */
export function SignatureBlock({
  view,
  u,
  signatureUrl,
}: {
  view: ReviewView;
  u: Units;
  signatureUrl?: string | null;
}) {
  if (view.signature.kind === "hidden") return null;

  return (
    <section
      className="flex justify-end"
      style={{ marginTop: u.mm(10), breakInside: "avoid", pageBreakInside: "avoid" }}
    >
      <div className="text-center">
        {view.signature.kind === "frozen" && signatureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signatureUrl}
            alt="The signature fixed to this prescription"
            style={{ height: u.mm(16), marginBottom: u.mm(1) }}
            className="object-contain"
          />
        ) : (
          <div style={{ height: u.mm(16) }} aria-hidden="true" />
        )}
        <div className="border-t border-ink/40" style={{ width: u.mm(45), marginBottom: u.mm(1) }} />
        <p style={{ fontSize: u.pt(view.baseFontPt * 0.85) }}>
          {view.header?.doctorName ?? "Signature"}
        </p>
      </div>
    </section>
  );
}

export function PrescriptionFooter({ view, u }: { view: ReviewView; u: Units }) {
  if (!view.showFooter || !view.footerText) return null;

  return (
    <footer
      className="border-t border-ink/15 whitespace-pre-wrap"
      style={{
        marginTop: u.mm(6),
        paddingTop: u.mm(2),
        fontSize: u.pt(view.baseFontPt * 0.8),
        breakInside: "avoid",
      }}
    >
      {view.footerText}
    </footer>
  );
}

/**
 * The whole document, in order.
 *
 * Both sheets render exactly this. They differ only in the box around it and
 * the units they hand in — which is the entire point.
 *
 * These are the DIRECT CHILDREN of a flex column (both sheets declare it), so
 * `MedicineList`'s `flex-1` absorbs the leftover height and the signature and
 * footer settle at the foot of the paper. Do not wrap them in a plain `<div>`
 * without carrying the column through, or the anchor silently stops working.
 */
export function PrescriptionDocument({
  view,
  u,
  signatureUrl,
}: {
  view: ReviewView;
  u: Units;
  signatureUrl?: string | null;
}) {
  return (
    <>
      <PrescriptionHeader view={view} u={u} />
      <PatientIdentity view={view} u={u} />

      {/*
        THE CLINICAL BODY — and the element that TAKES THE SLACK.

        `flex-1` here is what settles the signature and footer at the foot of a
        short page instead of leaving them stranded mid-sheet. It sits on the
        BODY rather than on the medicines because the advice is now the last
        thing printed, and the empty space belongs after everything the doctor
        wrote — not between the medicines and the tests.

        Growing the body rather than pushing the signature down with an auto
        margin matters on a long prescription: the signature stays attached to
        the content, so when the browser fragments the document it lands after
        the last thing written on the final page, not at a page bottom it does
        not belong to.
      */}
      <div className="flex flex-1 flex-col">
        <MedicineList view={view} u={u} />
        <InvestigationList view={view} u={u} />
        <AdviceBlock view={view} u={u} />
      </div>

      <SignatureBlock view={view} u={u} signatureUrl={signatureUrl} />
      <PrescriptionFooter view={view} u={u} />
    </>
  );
}
