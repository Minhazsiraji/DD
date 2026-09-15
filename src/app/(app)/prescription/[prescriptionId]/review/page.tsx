import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CloudOff, ImageOff, Lock, TriangleAlert } from "lucide-react";
import { requireLocationContext } from "@/lib/auth/session";
import { translateRxError } from "@/features/prescriptions/errors";
import {
  getPrescription,
  getReviewBundle,
  getSelectableTemplates,
} from "@/features/prescriptions/queries";
import { ReviewScreen } from "@/features/prescriptions/components/review-screen";
import { PrescriptionAssetProvider } from "@/features/prescriptions/components/prescription-asset-provider";

export const metadata: Metadata = { title: "Review prescription" };

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

  if (detail.prescription.status !== "DRAFT") {
    redirect(`/prescription/${prescriptionId}`);
  }

  const outcome = await getReviewBundle(prescriptionId, ctx.locationId, null);

  if (!outcome.ok && outcome.reason === "unsupported-schema") {
    return (
      <Refusal
        icon={<Lock className="mx-auto size-8 text-ink-muted" aria-hidden="true" />}
        title="This prescription cannot be shown safely"
        body="It was prepared by a newer version of Doctor's Diary. Update the app before reviewing it — showing it here could leave something out."
      />
    );
  }

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
  const patient = detail.prescription.patient;
  const allergies = patient.allergies.map((allergy) => allergy.substance);
  const conditions = patient.conditions.map((condition) => condition.condition);
  const initialClinicLogoKey = outcome.review.bundle.clinicLogo?.path ?? null;

  return (
    <div className="space-y-4">
      <section
        data-prescription-review-safety-context
        aria-label="Patient safety context"
        className="clinical-surface sticky top-2 z-20 min-w-0 rounded-glass border-l-4 border-l-danger px-4 py-3 shadow-soft"
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            {allergies.length > 0 ? (
              <p className="flex min-w-0 items-start gap-2 break-words text-[13px] font-semibold text-[#a81c1c]">
                <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="font-bold uppercase">Allergy:</strong>{" "}
                  {allergies.join(", ")}
                </span>
              </p>
            ) : (
              <p className="text-[13px] font-medium text-ink-secondary">
                No known drug allergies recorded
              </p>
            )}
            {conditions.length > 0 ? (
              <p className="mt-1 break-words text-[12px] text-ink-secondary">
                <strong className="font-semibold text-ink">Conditions:</strong>{" "}
                {conditions.join(" · ")}
              </p>
            ) : null}
          </div>
          <p className="shrink-0 text-[11px] text-ink-muted sm:text-right">
            Patient safety · review only · not printed
          </p>
        </div>
      </section>

      <PrescriptionAssetProvider
        prescriptionId={prescriptionId}
        initialClinicLogoKey={initialClinicLogoKey}
      >
        <ReviewScreen
          prescriptionId={prescriptionId}
          encounterId={detail.prescription.encounterId}
          initialReview={outcome.review}
          templates={templates}
          initialTemplateId={null}
        />
      </PrescriptionAssetProvider>
    </div>
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
