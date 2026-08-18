"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleAlert, FileWarning, Loader2, PenLine, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { refreshReviewAction } from "../actions";
import { parseReview, type ReviewEnvelope } from "../review-bundle";
import { toReviewView } from "../review-view";
import { ReviewSheet } from "./review-sheet";

export interface TemplateChoice {
  id: string;
  name: string;
  scope: "global" | "location";
  isDefault: boolean;
  paperSize: "A4" | "A5";
}

/**
 * The review screen — read, not write.
 *
 * Stage 7C-1 is deliberately NON-FINALIZING. There is no approval control here
 * and no code path from this screen to `finalize_prescription`; that arrives in
 * 7C-2B, after the signature freeze has been built and proved. A review screen
 * that can finalise before the freeze exists would be a button that sometimes
 * produces an unsigned permanent record.
 *
 * Everything rendered comes from the server's canonical bundle. Changing the
 * template re-asks the SERVER for a new bundle rather than re-rendering the old
 * one differently — the digest must always describe what is on the screen.
 */
export function ReviewScreen({
  prescriptionId,
  encounterId,
  initialReview,
  templates,
  initialTemplateId,
}: {
  prescriptionId: string;
  encounterId: string;
  initialReview: ReviewEnvelope;
  templates: TemplateChoice[];
  initialTemplateId: string | null;
}) {
  const router = useRouter();
  const [review, setReview] = React.useState(initialReview);
  const [templateId, setTemplateId] = React.useState(initialTemplateId);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const view = React.useMemo(() => toReviewView(review.bundle), [review]);

  /**
   * A different layout is a different printable prescription, so it is a new
   * SERVER bundle with a new digest — never the same bundle re-styled.
   */
  async function chooseTemplate(next: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await refreshReviewAction({ prescriptionId, templateId: next });
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    const parsed = parseReview(result.review);
    if (!parsed.ok) {
      setError(
        parsed.reason === "unsupported-schema"
          ? "This prescription needs a newer version of the app to display safely."
          : "The prescription could not be read. Reload and try again.",
      );
      return;
    }
    setTemplateId(next);
    setReview(parsed.review);
  }

  return (
    <div className="space-y-4 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/prescription/${prescriptionId}`}
          className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the medicines
        </Link>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Reload
        </button>
      </div>

      {/*
        The one thing this screen must not let a doctor assume. It looks like a
        finished prescription, so it says plainly that it is not one.
      */}
      <p
        role="status"
        className="clinical-surface flex items-start gap-2 rounded-glass border-l-4 border-l-brand px-4 py-3 text-[13px] text-ink-secondary"
      >
        <FileWarning className="mt-px size-4 shrink-0 text-brand" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-ink">This is a draft.</strong> Nothing here is part
          of the patient&rsquo;s record yet, and this screen cannot approve it. Approval and
          printing arrive in a later release.
        </span>
      </p>

      {error ? (
        <p
          role="alert"
          className="clinical-surface flex items-start gap-2 rounded-glass border-l-4 border-l-danger px-4 py-3 text-[13px] font-medium text-[#a81c1c]"
        >
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <SectionCard>
        <SectionHeader title="Layout" icon={<PenLine className="size-4" />} />
        <div className="space-y-2 p-4 sm:p-5">
          <div className="flex flex-wrap gap-1.5">
            <TemplateChip
              label="Default for this location"
              detail={
                view.templateSource === "system" ? "built-in" : `${view.templateSource} default`
              }
              active={templateId === null}
              busy={busy}
              onClick={() => void chooseTemplate(null)}
            />
            {templates.map((t) => (
              <TemplateChip
                key={t.id}
                label={t.name}
                detail={`${t.scope} · ${t.paperSize}`}
                active={templateId === t.id}
                busy={busy}
                onClick={() => void chooseTemplate(t.id)}
              />
            ))}
          </div>
          <p className="text-[12px] text-ink-muted">
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Rebuilding the prescription…
              </span>
            ) : (
              <>
                Printing on {view.paperSize} paper
                {view.templateName ? ` · ${view.templateName}` : ""}.
              </>
            )}
          </p>
        </div>
      </SectionCard>

      <div className={cn("transition-opacity", busy && "opacity-60")}>
        <ReviewSheet view={view} />
      </div>

      {/*
        The signature is frozen BEFORE the review that gets approved, not
        during approval — freezing changes the bundle, and therefore the digest
        (ADR 0012). So this screen shows an empty block and says so, rather than
        drawing the doctor's live profile signature, which the bundle does not
        attest and which could change afterwards.
      */}
      {view.signature.kind === "not-frozen" ? (
        <p className="text-[12px] text-ink-muted">
          The signature block is empty because nothing has been fixed to this prescription yet.
          Preparing it for final review copies the signature in, and you will read and approve the
          prescription with the signature already on it.
        </p>
      ) : null}

      {/*
        The digest, shown deliberately. It is what the doctor will later approve,
        and having it visible during the pilot makes a stale-review report
        something we can check rather than take on trust.
      */}
      <p className="font-mono text-[11px] break-all text-ink-muted">
        v{review.version} · {review.digest}
      </p>

      <Link
        href={`/consultation/${encounterId}`}
        className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the consultation
      </Link>
    </div>
  );
}

function TemplateChip({
  label,
  detail,
  active,
  busy,
  onClick,
}: {
  label: string;
  detail: string;
  active: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 flex-col items-start rounded-xl border px-3 py-1.5 text-left transition-colors disabled:opacity-55 focus-visible:focus-ring",
        active
          ? "border-brand bg-brand-soft text-brand"
          : "border-hairline bg-white text-ink-secondary hover:bg-surface-muted",
      )}
    >
      <span className="text-[13px] font-semibold">{label}</span>
      <span className="text-[11px] opacity-80">{detail}</span>
    </button>
  );
}
