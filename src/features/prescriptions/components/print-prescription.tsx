"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CircleAlert, History, Loader2, Printer } from "lucide-react";
import { frozenSignatureUrlAction } from "../actions";
import {
  confirmPrescriptionPrintAction,
  getPrescriptionPrintHistoryAction,
  initiatePrescriptionPrintAction,
  type PrescriptionPrintHistory,
  type PrintOperation,
} from "../m3-actions";
import type { PrescriptionView } from "../prescription-view";
import { PrintSheet } from "./print-sheet";

/**
 * Printing an approved prescription.
 *
 * Two things have to be true before the button does anything, and both are
 * about not producing a piece of paper that lies:
 *
 *   1. If the approved bundle attests a signature, the FROZEN image must have
 *      loaded AND decoded. An <img> element existing is not the same as pixels
 *      being ready — printing a moment too early yields a signed prescription
 *      with a blank signature, and nobody looking at it afterwards can tell
 *      that is what happened.
 *
 *   2. Nothing may be wider than the paper. LENGTH is no longer a problem —
 *      the document flows and the browser fragments it into pages — but text
 *      cannot flow sideways, so a too-wide line would genuinely be lost off
 *      the edge.
 *
 * Neither failure falls back to something plausible. There is no "print without
 * the signature", and no shrinking text until it fits.
 *
 * M3 adds an operational ledger AROUND this frozen print path. It does not
 * change what is printed or how Chromium receives the sheet:
 *
 *   server PRINT_INITIATED → this same native window.print()
 *   → explicit human confirmation → server PRINT_CONFIRMED
 *
 * Returning from window.print() is deliberately NOT confirmation. The browser
 * cannot tell us whether paper came out, Save as PDF was chosen, or the dialog
 * was cancelled.
 */
type Readiness =
  | { kind: "preparing" }
  /** The signature is either not required or fully loaded. */
  | { kind: "ready" }
  /** The bundle attests a signature we could not retrieve. */
  | { kind: "signature-unavailable" }
  /**
   * The document is wider than the page. Vertical length is fine — it
   * paginates — but nothing can flow sideways, so this would genuinely lose
   * text off the edge.
   */
  | { kind: "too-wide" };

function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function actorLabel(history: NonNullable<PrescriptionPrintHistory["latestInitiation"]>): string {
  return `${history.actorName} · ${history.authorizationBasis === "DOCTOR_OWNER" ? "Doctor" : "Staff"}`;
}

export function PrintPrescription({
  prescriptionId,
  view,
}: {
  prescriptionId: string;
  view: PrescriptionView;
}) {
  const needsSignature = view.signature.kind === "frozen";
  const [signatureUrl, setSignatureUrl] = React.useState<string | null>(null);
  const [signatureReady, setSignatureReady] = React.useState(!needsSignature);
  const [signatureFailed, setSignatureFailed] = React.useState(false);
  const [measured, setMeasured] = React.useState(false);
  const [tooWide, setTooWide] = React.useState(false);

  /** M3 operational state. None of this changes the printable DOM or CSS. */
  const initiationKey = React.useRef<string | null>(null);
  const [pendingOperation, setPendingOperation] = React.useState<PrintOperation | null>(null);
  const [confirmationOpen, setConfirmationOpen] = React.useState(false);
  const [copyCount, setCopyCount] = React.useState("1");
  const [printBusy, setPrintBusy] = React.useState(false);
  const [printError, setPrintError] = React.useState<string | null>(null);
  const [printNotice, setPrintNotice] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<PrescriptionPrintHistory | null>(null);
  const [historyLoading, setHistoryLoading] = React.useState(true);
  const [historyError, setHistoryError] = React.useState<string | null>(null);

  /**
   * `document` does not exist while this renders on the server, and the portal
   * needs it. Mounting first also keeps the server and client markup identical,
   * so there is no hydration mismatch.
   */
  /**
   * Are we on the client yet?
   *
   * `document` does not exist during SSR and the portal needs it. This is the
   * canonical way to ask: the server snapshot is `false`, the client snapshot
   * is `true`, and React reconciles the difference itself — so there is no
   * hydration mismatch and no setState in an effect.
   */
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  /**
   * The ref goes on a wrapper this component owns, and the page box is found
   * inside it — rather than forwarding a ref through `PrintSheet`.
   *
   * Ref-as-prop through a function component depends on React version
   * semantics, and when it silently does not attach, BOTH effects below become
   * no-ops: the signature never reports ready and the overflow never measures,
   * so the button sits on "Preparing…" forever with no error. That is a bad
   * failure to have between a doctor and a prescription, and it is avoidable by
   * not depending on the mechanism at all.
   */
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const sheet = () => wrapperRef.current?.querySelector<HTMLElement>("[data-print-root]") ?? null;

  /**
   * Fetch the frozen signature's short-lived URL. Regenerated on every view and
   * never stored — a URL expires, and a prescription does not.
   */
  React.useEffect(() => {
    if (!needsSignature) return;
    let cancelled = false;
    void frozenSignatureUrlAction(prescriptionId).then((r) => {
      if (cancelled) return;
      if (r.ok) setSignatureUrl(r.url);
      else setSignatureFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needsSignature, prescriptionId]);

  /** Compact operational history; failure never blocks the frozen print path. */
  const refreshHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await getPrescriptionPrintHistoryAction({ prescriptionId });
      if (result.ok) setHistory(result.history);
      else setHistoryError(result.message);
    } catch {
      setHistoryError("Print history is unavailable right now.");
    } finally {
      setHistoryLoading(false);
    }
  }, [prescriptionId]);

  React.useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  /**
   * Wait for the frozen signature to be genuinely paintable.
   *
   * An `<img>` having a `src` is not the same as pixels being ready: printing a
   * moment too early yields a signed prescription with a blank signature, and
   * nobody looking at that piece of paper afterwards can tell that is what
   * happened.
   */
  React.useEffect(() => {
    if (!needsSignature || !signatureUrl) return;
    let cancelled = false;
    const img = sheet()?.querySelector("img");
    if (!img) return;

    const ready = () => {
      if (!cancelled) setSignatureReady(true);
    };

    /**
     * `decode()` alone is not enough here, and this cost a debugging session.
     *
     * The sheet is positioned far off-screen so it can be measured without
     * being seen, and Chromium does not necessarily decode an image it is not
     * painting — so the promise can simply stay pending, leaving the button on
     * "Preparing…" forever with no error anywhere.
     *
     * So LOADED is the readiness signal, and decode is a bounded refinement on
     * top of it: we give it a moment to guarantee paint-readiness, and proceed
     * on the load state if it does not settle. Both facts are about the same
     * image; only one of them is reliable off-screen.
     */
    const settle = () => {
      if (cancelled) return;
      if (!(img.complete && img.naturalWidth > 0)) {
        setSignatureFailed(true);
        return;
      }
      void Promise.race([
        img.decode().catch(() => undefined),
        new Promise((r) => setTimeout(r, 1000)),
      ]).then(ready);
    };

    if (img.complete) {
      settle();
    } else {
      img.addEventListener("load", settle, { once: true });
      img.addEventListener(
        "error",
        () => {
          if (!cancelled) setSignatureFailed(true);
        },
        { once: true },
      );
    }

    return () => {
      cancelled = true;
      img.removeEventListener("load", settle);
    };
    // `mounted`: the sheet is portalled, so it does not exist on the first pass.
  }, [needsSignature, signatureUrl, mounted]);

  /**
   * Measure the real document against the real page.
   *
   * The sheet is sized in absolute millimetres, so this measurement is exact
   * on screen too — a millimetre is a fixed number of CSS pixels regardless of
   * media. Measured, never guessed from a medicine count: a single long Bangla
   * instruction can overflow a page that ten short medicines would not.
   */
  React.useEffect(() => {
    const el = sheet();
    if (!el) return;

    const measure = () => {
      /**
       * WIDTH only.
       *
       * Height is not a failure any more — the sheet flows and `@page`
       * fragments it — and it is deliberately not counted either. Dividing
       * content height by page height looks like a page count but is not one:
       * `break-inside`, orphans and widows, font metrics and the printer's own
       * scaling all move the breaks. A number that is usually right is worse
       * than no number, because it gets believed.
       *
       * Width genuinely cannot flow, so a line wider than the paper really
       * would be lost off the edge. That is the one thing left to measure.
       */
      setTooWide(el.scrollWidth > el.clientWidth + 1);
      setMeasured(true);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // `mounted`: the sheet is portalled, so it does not exist on the first pass.
  }, [view, signatureUrl, mounted]);

  const readiness: Readiness =
    signatureFailed ? { kind: "signature-unavailable" }
    : !measured || (needsSignature && !signatureReady) ? { kind: "preparing" }
    : tooWide ? { kind: "too-wide" }
    : { kind: "ready" };

  /**
   * Record initiation FIRST, then open the exact frozen native print flow.
   * Retrying an uncertain initiation reuses the same idempotency key; the
   * accepted backend either returns the existing operation or refuses a changed
   * request. We never open print unless the initiation is verified.
   */
  async function print() {
    if (readiness.kind !== "ready" || printBusy || confirmationOpen) return;
    setPrintBusy(true);
    setPrintError(null);
    setPrintNotice(null);
    initiationKey.current ??= `m3-print-${crypto.randomUUID()}`;

    try {
      const result = await initiatePrescriptionPrintAction({
        prescriptionId,
        idempotencyKey: initiationKey.current,
      });
      if (!result.ok) {
        setPrintError(result.message);
        return;
      }

      setPendingOperation(result.operation);
      await refreshHistory();

      /**
       * FROZEN M2 NATIVE PRINT PATH. Do not replace this with an iframe, PDF
       * generator, popup document or client-side clone. The direct-body portal
       * below plus this exact native call are the UAT-proven architecture.
       */
      window.print();

      // Returning from the native dialog says nothing about physical paper.
      setCopyCount("1");
      setConfirmationOpen(true);
    } catch {
      setPrintError(
        "We could not verify the print initiation, so the native print dialog was not opened. Try Print again; the same request will be checked rather than duplicated.",
      );
    } finally {
      setPrintBusy(false);
    }
  }

  async function confirmPrintedCopies() {
    if (!pendingOperation || printBusy) return;
    const count = Number(copyCount);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setPrintError("Enter the physical copies that actually printed, from 1 to 100.");
      return;
    }

    setPrintBusy(true);
    setPrintError(null);
    try {
      const result = await confirmPrescriptionPrintAction({
        operationId: pendingOperation.operationId,
        copyCount: count,
      });
      if (!result.ok) {
        setPrintError(result.message);
        return;
      }

      setPendingOperation(null);
      setConfirmationOpen(false);
      initiationKey.current = null;
      setPrintNotice(
        `${result.operation.confirmedCopyCount ?? count} physical ${count === 1 ? "copy" : "copies"} confirmed.`,
      );
      await refreshHistory();
    } catch {
      setPrintError(
        "We could not verify the confirmation. Do not enter a different copy count; retry this same confirmation after the connection recovers.",
      );
    } finally {
      setPrintBusy(false);
    }
  }

  /**
   * Explicitly say no physical copy printed. The initiation stays in the ledger
   * as initiation-only; this button performs NO confirmation write.
   */
  function leaveUnconfirmed() {
    setPendingOperation(null);
    setConfirmationOpen(false);
    initiationKey.current = null;
    setPrintError(null);
    setPrintNotice("No physical copies were confirmed. The print initiation remains recorded as unconfirmed.");
    void refreshHistory();
  }

  const latestInitiation = history?.latestInitiation ?? null;
  const latestConfirmed = history?.latestConfirmedPrint ?? null;

  return (
    <>
      {/*
        AN ACTION, NOT A PANEL.

        This was a titled `SectionCard` sitting under the paper — a second
        document-sized block competing with the document, on a screen whose
        whole job is to show one prescription. A finalised prescription is
        read, then printed; the control belongs in the row of actions above the
        sheet, and the paper below it should be the only large thing on the
        page.

        The explanatory line stays, because "Print" opening a dialog that can
        also save a PDF is worth saying once — but as a caption under the
        button, not as a paragraph in a panel.
      */}
      <div data-print-hidden className="flex min-w-0 flex-1 flex-col items-start gap-2">
        {readiness.kind === "signature-unavailable" ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            This prescription is safely stored, but its approved signature could not be loaded.
            Printing is unavailable until the signature can be retrieved — reload in a moment, and
            tell support if it keeps happening.
          </p>
        ) : null}

        {readiness.kind === "too-wide" ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] font-medium text-ink"
          >
            <CircleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
            Something on this prescription is wider than the paper. Length is fine — it would print
            across more pages — but text cannot flow sideways, so printing now would lose part of a
            line off the edge.
          </p>
        ) : null}

        {printError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>{printError}</span>
          </p>
        ) : null}

        {printNotice ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl bg-success-soft px-3 py-2 text-[12px] font-medium text-ink"
          >
            <CheckCircle2 className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
            <span>{printNotice}</span>
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void print()}
          disabled={readiness.kind !== "ready" || printBusy || confirmationOpen}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
        >
          {readiness.kind === "preparing" || printBusy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Printer className="size-4" aria-hidden="true" />
          )}
          {readiness.kind === "preparing"
            ? "Preparing…"
            : printBusy
              ? "Recording print…"
              : confirmationOpen
                ? "Awaiting print confirmation"
                : "Print prescription"}
        </button>

        {/*
          Named for what it does. A "Download PDF" button that only opens the
          print dialog would be claiming the app produced a file it did not.
        */}
        <p className="text-[12px] text-ink-muted">
          In the print dialog, choose your printer or &ldquo;Save as PDF&rdquo;. Prints on{" "}
          {view.paperSize} at a {view.marginMm} mm margin — the layout this prescription was
          approved on.
        </p>

        {confirmationOpen && pendingOperation ? (
          <div className="dd-material-record dd-record-pearl w-full max-w-md rounded-2xl p-3 sm:p-4">
            <p className="text-[13px] font-semibold text-ink">Did physical copies actually print?</p>
            <p className="mt-1 text-[11px] text-ink-muted">
              Closing the browser print dialog is not proof of printing. Confirm only paper copies
              that actually came out. Saving a PDF is not a physical copy.
            </p>
            <label className="mt-3 block text-[12px] font-semibold text-ink-secondary">
              Physical copies printed
              <input
                type="number"
                min={1}
                max={100}
                inputMode="numeric"
                value={copyCount}
                disabled={printBusy}
                onChange={(event) => setCopyCount(event.target.value)}
                className="mt-1 h-11 w-28 rounded-xl border border-hairline bg-white px-3 text-[15px] tabular-nums text-ink focus-visible:focus-ring"
              />
            </label>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={printBusy}
                onClick={() => void confirmPrintedCopies()}
                className="dd-primary inline-flex min-h-11 items-center justify-center gap-1.5 px-4 text-[12px] font-semibold disabled:opacity-55 focus-visible:focus-ring"
              >
                {printBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                )}
                Confirm printed copies
              </button>
              <button
                type="button"
                disabled={printBusy}
                onClick={leaveUnconfirmed}
                className="dd-secondary inline-flex min-h-11 items-center justify-center px-4 text-[12px] font-semibold disabled:opacity-55 focus-visible:focus-ring"
              >
                No physical copy printed
              </button>
            </div>
          </div>
        ) : null}

        <div className="w-full max-w-md rounded-xl border border-hairline/80 bg-white/55 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-secondary">
            <History className="size-3.5" aria-hidden="true" />
            Print history
          </p>
          {historyLoading ? (
            <p className="mt-1 text-[11px] text-ink-muted">Loading recent print state…</p>
          ) : historyError ? (
            <p className="mt-1 text-[11px] text-ink-muted">{historyError}</p>
          ) : latestInitiation ? (
            <div className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
              {latestInitiation.confirmedAt ? (
                <p>
                  Latest print: confirmed {latestInitiation.confirmedCopyCount ?? 0} physical{" "}
                  {(latestInitiation.confirmedCopyCount ?? 0) === 1 ? "copy" : "copies"} ·{" "}
                  {actorLabel(latestInitiation)} · {when(latestInitiation.confirmedAt)}
                </p>
              ) : (
                <p>
                  Latest print: initiated · not confirmed · {actorLabel(latestInitiation)} ·{" "}
                  {when(latestInitiation.initiatedAt)}
                </p>
              )}
              {latestConfirmed && latestConfirmed.operationId !== latestInitiation.operationId ? (
                <p>
                  Last confirmed: {latestConfirmed.confirmedCopyCount ?? 0} physical{" "}
                  {(latestConfirmed.confirmedCopyCount ?? 0) === 1 ? "copy" : "copies"} ·{" "}
                  {actorLabel(latestConfirmed)} · {when(latestConfirmed.confirmedAt)}
                </p>
              ) : null}
              <p>Total confirmed physical copies: {history?.totalConfirmedCopies ?? 0}</p>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-ink-muted">No print initiation has been recorded yet.</p>
          )}
        </div>
      </div>

      {/*
        The paper itself — rendered as a DIRECT CHILD OF <body>, through a
        portal.

        WHY IT LEAVES THE REACT TREE

        Print used to hide the app with `visibility: hidden`, which paints
        nothing but KEEPS EVERY BOX. The shell is `min-h-dvh` and the page's own
        content sits inside it, so the document stayed 416mm tall for a
        prescription that was 167mm — and Chromium duly produced a second, empty
        A4 page. Measured, not guessed: the sheet was 167.1mm and the document
        415.9mm.

        No amount of `height: auto` fixes that from inside, because the height
        comes from real content in normal flow. The sheet has to stop being
        inside it. As a direct child of body, print can simply `display: none`
        every sibling, and the document becomes exactly as tall as the paper.

        Off-screen but LAID OUT on screen — it needs real dimensions for the
        width measurement to mean anything, so it is never `display: none` there.
      */}
      {mounted
        ? createPortal(
            <div data-print-only aria-hidden="true" ref={wrapperRef}>
              <PrintSheet view={view} signatureUrl={signatureUrl} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
