import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export default async function BookingConfirmedPage(props: PageProps<"/dr/[slug]/book/confirmed">) {
  const { slug } = await props.params;
  const search = await props.searchParams;
  const ref = typeof search.ref === "string" ? search.ref : "";

  return (
    <MarketingShell>
      <section className="mx-auto max-w-2xl px-5 py-16 lg:px-8">
        <div className="rounded-[2rem] border border-teal-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-teal-50 text-2xl text-teal-700">✓</div>
          <h1 className="mt-5 text-3xl font-semibold">Appointment requested</h1>
          <p className="mt-3 text-slate-600">
            Your booking has been added to the doctor&apos;s appointment system.
          </p>
          {ref && (
            <p className="mt-5 rounded-xl bg-slate-50 px-4 py-3 font-mono text-sm text-slate-700">
              Reference: {ref}
            </p>
          )}
          <p className="mt-5 text-sm text-slate-500">
            This page does not expose your medical record or patient ID.
          </p>
          <Link href={`/dr/${encodeURIComponent(slug)}`} className="mt-6 inline-flex rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold">
            Back to doctor profile
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
