import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { getPublicDoctor } from "@/features/public-booking/queries";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function generateMetadata(props: PageProps<"/dr/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const doctor = await getPublicDoctor(slug);
  return {
    title: doctor ? `${doctor.fullName} · Doctor Profile` : "Doctor Profile",
    robots: doctor ? undefined : { index: false, follow: false },
  };
}

export default async function PublicDoctorPage(props: PageProps<"/dr/[slug]">) {
  const { slug } = await props.params;
  const doctor = await getPublicDoctor(slug);
  if (!doctor) notFound();

  return (
    <MarketingShell>
      <section className="mx-auto max-w-5xl px-5 py-12 lg:px-8 lg:py-20">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-700">
            Professional profile
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">{doctor.fullName}</h1>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-slate-600">
            {doctor.designation && <span>{doctor.designation}</span>}
            {doctor.specialization && <span>· {doctor.specialization}</span>}
            {doctor.qualification && <span>· {doctor.qualification}</span>}
          </div>
          {doctor.bmdc && (
            <p className="mt-3 text-sm text-slate-500">
              BMDC: {doctor.bmdc} <span className="ml-1">(doctor-displayed; verification badge not implied)</span>
            </p>
          )}
        </div>

        <div className="mt-8 grid gap-5">
          {doctor.chambers.map((chamber) => (
            <article key={chamber.chamberId} className="rounded-3xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{chamber.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {[chamber.address, chamber.district].filter(Boolean).join(", ")}
                  </p>
                  {chamber.publicNote && <p className="mt-2 text-sm text-slate-500">{chamber.publicNote}</p>}
                </div>
                {chamber.bookingEnabled && (
                  <Link
                    href={`/dr/${encodeURIComponent(slug)}/book?loc=${chamber.locationId}`}
                    className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
                  >
                    Book Now
                  </Link>
                )}
              </div>

              {chamber.sessions.length > 0 && (
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {chamber.sessions.map((s, i) => (
                    <div key={`${s.weekday}-${s.startsAt}-${i}`} className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <span className="font-semibold">{DAYS[s.weekday] ?? "Day"}</span>{" "}
                      {s.startsAt}–{s.endsAt}
                    </div>
                  ))}
                </div>
              )}

              {chamber.consultationFee != null && (
                <p className="mt-4 text-sm font-medium text-slate-700">
                  Consultation fee: {chamber.currency} {String(chamber.consultationFee)}
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
