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
      <section className="mx-auto min-w-0 max-w-5xl px-4 py-8 sm:px-5 sm:py-12 lg:px-8 lg:py-20">
        <div className="min-w-0 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700 sm:text-sm sm:tracking-[0.16em]">
            Professional profile
          </p>
          <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{doctor.fullName}</h1>
          <div className="mt-3 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600 sm:text-base">
            {doctor.designation && <span className="break-words">{doctor.designation}</span>}
            {doctor.specialization && <span className="break-words">· {doctor.specialization}</span>}
            {doctor.qualification && <span className="break-words">· {doctor.qualification}</span>}
          </div>
          {doctor.bmdc && (
            <p className="mt-3 break-words text-sm text-slate-500">
              BMDC: {doctor.bmdc} <span className="ml-1">(doctor-displayed; verification badge not implied)</span>
            </p>
          )}
        </div>

        <div className="mt-6 grid min-w-0 gap-5 sm:mt-8">
          {doctor.chambers.map((chamber) => (
            <article key={chamber.chamberId} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex min-w-0 flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-xl font-semibold">{chamber.name}</h2>
                  <p className="mt-1 break-words text-sm text-slate-600">
                    {[chamber.address, chamber.district].filter(Boolean).join(", ")}
                  </p>
                  {chamber.publicNote && <p className="mt-2 break-words text-sm text-slate-500">{chamber.publicNote}</p>}
                </div>
                {chamber.bookingEnabled && (
                  <Link
                    href={`/dr/${encodeURIComponent(slug)}/book?loc=${chamber.locationId}`}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 sm:w-auto"
                  >
                    Book Now
                  </Link>
                )}
              </div>

              {chamber.sessions.length > 0 && (
                <div className="mt-5 grid min-w-0 gap-2 sm:grid-cols-2">
                  {chamber.sessions.map((s, i) => (
                    <div key={`${s.weekday}-${s.startsAt}-${i}`} className="min-w-0 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <span className="font-semibold">{DAYS[s.weekday] ?? "Day"}</span>{" "}
                      <span className="tabular-nums">{s.startsAt}–{s.endsAt}</span>
                    </div>
                  ))}
                </div>
              )}

              {chamber.consultationFee != null && (
                <p className="mt-4 break-words text-sm font-medium text-slate-700">
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
