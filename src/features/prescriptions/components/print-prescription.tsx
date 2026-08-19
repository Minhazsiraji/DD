"use client";

import * as React from "react";
import { CircleAlert, Loader2, Printer } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { frozenSignatureUrlAction } from "../actions";
import type { ReviewView } from "../review-view";
import { PAPER_MM } from "@/features/doctor/schema";
import { ContinuationIdentity } from "./prescription-parts";
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

const MM_PER_PX = 25.4 / 96;

export function PrintPrescription({
  prescriptionId,
  view,
}: {
  prescriptionId: string;
  view: ReviewView;
}) {
  const needsSignature = view.signature.kind === "frozen";
  const [signatureUrl, setSignatureUrl] = React.useState<string | null>(null);
  const [signatureReady, setSignatureReady] = React.useState(!needsSignature);
  const [signatureFailed, setSignatureFailed] = React.useState(false);
  const [pages, setPages] = React.useState<number | null>(null);
  const [tooWide, setTooWide] = React.useState(false);

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
  }, [needsSignature, signatureUrl]);

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
       * HEIGHT is no longer a failure. The sheet flows and `@page` fragments
       * it, so a long prescription becomes more pages rather than a refusal.
       * What is measured now is the page count — useful to a doctor deciding
       * whether to print — and horizontal overflow, which cannot paginate and
       * would genuinely run text off the edge of the paper.
       */
      const paper = PAPER_MM[view.paperSize];
      const usableHeightMm = paper.h - view.marginMm * 2;
      const contentMm = el.getBoundingClientRect().height * MM_PER_PX;

      setPages(Math.max(1, Math.ceil(contentMm / usableHeightMm - 0.02)));
      setTooWide(el.scrollWidth > el.clientWidth + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [view, signatureUrl]);

  const readiness: Readiness =
    signatureFailed ? { kind: "signature-unavailable" }
    : pages === null || (needsSignature && !signatureReady) ? { kind: "preparing" }
    : tooWide ? { kind: "too-wide" }
    : { kind: "ready" };

  function print() {
    if (readiness.kind !== "ready") return;
    window.print();
  }

  return (
    <>
      <SectionCard data-print-hidden>
        <div className="space-y-3 p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-ink">Print this prescription</h2>

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
              Something on this prescription is wider than the paper. Length is fine — it would
              print across more pages — but text cannot flow sideways, so printing now would lose
              part of a line off the edge.
            </p>
          ) : null}

          <button
            type="button"
            onClick={print}
            disabled={readiness.kind !== "ready"}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
          >
            {readiness.kind === "preparing" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Printer className="size-4" aria-hidden="true" />
            )}
            {readiness.kind === "preparing" ? "Preparing…" : "Print prescription"}
          </button>

          {/*
            Named for what it does. A "Download PDF" button that only opens the
            print dialog would be claiming the app produced a file it did not.
          */}
          <p className="text-[12px] text-ink-muted">
            In the print dialog, choose your printer or &ldquo;Save as PDF&rdquo;. This prints on{" "}
            {view.paperSize} paper with a {view.marginMm} mm margin — the layout this prescription
            was approved on.
            {pages && pages > 1 ? (
              <>
                {" "}
                It runs to about {pages} pages; the exact break depends on your printer.
              </>
            ) : null}
          </p>
        </div>
      </SectionCard>

      {/*
        The paper itself.
        Off-screen but LAID OUT — it must have real dimensions for the overflow
        measurement to mean anything, so it cannot be `display: none`. In print
        media it becomes the only visible thing on the page.
      */}
      <div data-print-only aria-hidden="true" ref={wrapperRef}>
        {/*
          Outside the measured sheet on purpose: it is a page-level marker, and
          including it in the flow would both add its height to the page count
          and print it once at the top instead of on the pages that need it.
        */}
        <ContinuationIdentity view={view} />
        <PrintSheet view={view} signatureUrl={signatureUrl} />
      </div>
    </>
  );
}
