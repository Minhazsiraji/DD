import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CloudOff, FileWarning, ImageOff, Lock } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { translateRxError } from "@/features/prescriptions/errors";
import { getPrescription, getReviewBundle, getSelectableTemplates } from "@/features/prescriptions/queries";
import { ReviewScreen } from "@/features/prescriptions/components/review-screen";

export const metadata: Metadata = { title: "Review prescription" };

/**
 * The review screen.
 *
 * Reads the canonical bundle server-side and hands it to the client whole. The
 * client is given the bundle, its digest and the prescription's version — never
 * the raw rows they were built from, because the doctor must review exactly
 * what the digest describes.
 *
 * Stage 7C-1 cannot finalise. Nothing on this route reaches
 * `finalize_prescription`.
 */
export default async function ReviewPage({
  params,
}: PageProps<"/prescription/[prescriptionId]/review">) {
  const { prescriptionId } = await params;
  const ctx = await requireLocationContext();

  const outcome = await getReviewBundle(prescriptionId, ctx.locationId, null);

  if (!outcome.ok && outcome.reason === "unsupported-schema") {
    /**
     * A bundle shape this build does not know. Refusing is the whole point:
     * rendering it would drop whatever the newer schema added, and the doctor
     * would be reading a prescription that is missing something.
     */
    return (
      <Refusal
        icon={<Lock className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
        title="This prescription cannot be shown safely"
        body="It was prepared by a newer version of Doctor's Diary. Update the app before reviewing it — showing it here could leave something out."
      />
    );
  }

  /**
   * The layout asks for a clinic logo, and no trusted logo identity exists in
   * the bundle to attest what would be drawn. Refusing is the point: rendering
   * nothing would silently drop something the template says prints.
   */
  if (!outcome.ok && outcome.reason === "logo-unsupported") {
    return (
      <Refusal
        icon={<ImageOff className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
        title="This layout cannot be reviewed yet"
        body={translateRxError("TEMPLATE_LOGO_UNSUPPORTED").message}
        href="/settings/prescription"
        cta="Open prescription layout settings"
      />
    );
  }

  if (!outcome.ok && outcome.reason === "unavailable") {
    return (
      <Refusal
        icon={<CloudOff className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
        title="This prescription could not be loaded"
        body="It exists — we simply could not reach it just now. Do not start another one for this patient; try again in a moment."
      />
    );
  }

  if (!outcome.ok) notFound();

  /**
   * The encounter id for the way back. Read separately and deliberately: the
   * bundle carries it, but a link is navigation, not clinical content, and
   * nothing on this page should start treating the bundle as a general-purpose
   * data source.
   */
  const detail = await getPrescription(prescriptionId, ctx.locationId);
  if (!detail.ok) notFound();

  if (detail.prescription.status !== "DRAFT") {
    // Finalised prescriptions get their own read-only route in Stage 7C-3.
    return (
      <Refusal
        icon={<FileWarning className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
        title="This prescription has already been approved"
        body="Approved prescriptions are read-only. Viewing and printing them arrives in a later release."
      />
    );
  }

  const templates = await getSelectableTemplates(ctx.locationId);

  return (
    <ReviewScreen
      prescriptionId={prescriptionId}
      encounterId={detail.prescription.encounterId}
      initialReview={outcome.review}
      templates={templates}
      initialTemplateId={null}
    />
  );
}

function Refusal({
  icon,
  title,
  body,
  href = "/queue",
  cta = "Back to the queue",
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  /** Where the doctor can actually fix it, when there is such a place. */
  href?: string;
  cta?: string;
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      {icon}
      <h1 className="mt-3 text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-[13px] text-ink-secondary">{body}</p>
      <Link
        href={href}
        className="mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {cta}
      </Link>
    </div>
  );
}
