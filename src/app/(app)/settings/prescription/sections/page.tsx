import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { requireUser } from "@/lib/auth/session";
import { getDoctorIdentity } from "@/features/doctor/queries";
import { getRxModulesAction } from "@/features/doctor/rx-module-actions";
import { RxModuleSettings } from "@/features/doctor/components/rx-module-settings";

export const metadata: Metadata = { title: "Prescription sections" };

/**
 * WHAT THE PRESCRIPTION CONTAINS — as distinct from what the paper looks like.
 *
 * `/settings/prescription` sets the header, footer and paper size. This sets
 * the clinical sections: which ones you write during a consultation, which ones
 * print, in what order, and under what heading.
 *
 * They are deliberately separate screens. One is about a chamber's stationery
 * and can differ per location; this one is the doctor's own way of working and
 * is the same wherever they practise.
 */
export default async function PrescriptionSectionsPage() {
  await requireUser();

  const identity = await getDoctorIdentity();
  const outcome = identity.doctorId ? await getRxModulesAction() : null;

  return (
    <div className="space-y-5 sm:space-y-6">
      <Link
        href="/settings/prescription"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Your prescription paper
      </Link>

      <PageHeader
        eyebrow="Prescription"
        title="What your prescription contains"
        subtitle="Choose the sections you write during a consultation, the ones that print, and the order they print in."
      />

      {/*
        THE FIRST QUESTION A DOCTOR SHOULD BE ABLE TO ANSWER.

        Changing a layout must never be something you worry about afterwards.
        Every finalised prescription carries its own frozen copy of these
        settings, so nothing here can reach a document that has been signed.
      */}
      <p className="rounded-glass bg-surface-muted px-4 py-3 text-[13px] text-ink-secondary">
        <strong className="font-semibold text-ink">This affects new prescriptions only.</strong>{" "}
        Anything you have already signed keeps the sections, order and headings it was signed with —
        changing them here cannot alter a prescription that already exists.
      </p>

      {!identity.doctorId ? (
        <p className="flex items-start gap-2 rounded-glass bg-warning-soft px-4 py-3 text-[13px] font-medium text-ink">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span>
            Fill in your{" "}
            <Link href="/settings/profile" className="underline">
              doctor details
            </Link>{" "}
            first — these sections belong to a doctor, and there is no doctor to attach them to yet.
          </span>
        </p>
      ) : outcome && !outcome.ok ? (
        /*
          A failed read is NOT "no configuration". Rendering the built-in
          defaults after a broken query would invite the doctor to press Save
          and overwrite settings they already have.
        */
        <p className="flex items-start gap-2 rounded-glass bg-danger-soft px-4 py-3 text-[13px] font-medium text-[#a81c1c]">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          Your sections could not be loaded, so nothing is shown here. Reload in a moment rather
          than setting them up again.
        </p>
      ) : outcome?.ok ? (
        <RxModuleSettings initial={outcome.modules} />
      ) : null}
    </div>
  );
}
