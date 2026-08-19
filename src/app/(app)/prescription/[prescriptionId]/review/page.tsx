import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CloudOff, ImageOff, Lock } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { translateRxError } from "@/features/prescriptions/errors";
import {
  getPrescription,
  getReviewBundle,
  getSelectableTemplates,
} from "@/features/prescriptions/queries";
import { ReviewScreen } from "@/features/prescriptions/components/review-screen";

export const metadata: Metadata = { title: "Review prescription" };

/**
 * The review screen, or the approved record.
 *
 * Which one depends on STATUS, and status is checked first — a finalised
 * prescription must never be rendered from a freshly built bundle. Building one
 * reads live rows, and a live row that has since changed could refuse (a logo
 * switched on, a template deleted) or simply differ. A permanent record cannot
 * become unviewable because a setting moved afterwards.
 *
 * For a draft, the canonical bundle is read server-side and handed to the
 * client whole: the bundle, its digest and the version — never the rows they
 * were built from, because the doctor must approve exactly what the digest
 * describes.
 */
export default async function ReviewPage({
  params,
}: PageProps<"/prescription/[prescriptionId]/review">) {
  const { prescriptionId } = await params;
  const ctx = await requireLocationContext();

  const detail = await getPrescription(prescriptionId, ctx.locationId);
  if (!detail.ok && detail.reason === "unavailable") {
    return (
      <Refusal
        icon={<CloudOff className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
        title="This prescription could not be loaded"
        body="It exists — we simply could not reach it just now. Do not start another one for this patient; try again in a moment."
      />
    );
  }
  if (!detail.ok) notFound();

  /**
   * Approved: there is nothing left to review, so this is not the page.
   *
   * It used to render the finalised record here as well, which meant the
   * permanent record had two homes and REVIEW — a doctor-only approval surface
   * — was one of them. Reception can read a finalised prescription, so a stale
   * link landed the front desk on the approval route showing a record. Sending
   * everyone to the one canonical page keeps "review" meaning a draft awaiting
   * a decision, and gives staff a route that was built for them.
   */
  if (detail.prescription.status !== "DRAFT") {
    redirect(`/prescription/${prescriptionId}`);
  }

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
