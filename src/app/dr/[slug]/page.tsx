import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { ChamberCard } from "@/features/public-booking/components/chamber-card";
import { DoctorHero } from "@/features/public-booking/components/doctor-hero";
import {
  getPublicDoctor,
  getPublicDoctorPhotoUrl,
} from "@/features/public-booking/queries";

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

  // Photo resolution is deliberately separate from the public profile RPC so
  // no storage key becomes public Postgres data. Failure keeps the initials
  // fallback instead of making the profile unavailable.
  const photoUrl = await getPublicDoctorPhotoUrl(slug);

  return (
    <MarketingShell>
      {/*
        IDENTITY -> CREDIBILITY -> CHAMBERS -> BOOKING, in that order down the
        page, because that is the order a patient decides in: who is this, why
        should I trust them, where do they sit, how do I get in.
      */}
      <section className="mx-auto min-w-0 max-w-5xl px-4 py-8 sm:px-5 sm:py-12 lg:px-8 lg:py-20">
        <DoctorHero
          fullName={doctor.fullName}
          photoUrl={photoUrl}
          designation={doctor.designation}
          specialization={doctor.specialization}
          qualification={doctor.qualification}
          bmdc={doctor.bmdc}
        />

        <h2 className="mt-10 min-w-0 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:mt-12">
          {doctor.chambers.length === 1 ? "Chamber" : "Chambers"}
        </h2>

        {/*
          Vertical at every width. Chambers are compared by reading them, not by
          scrolling sideways past them, and a horizontal rail on a phone hides
          the one the patient wanted.
        */}
        <div className="mt-3 grid min-w-0 gap-5">
          {doctor.chambers.map((chamber) => (
            <ChamberCard key={chamber.chamberId} slug={slug} chamber={chamber} />
          ))}

          {doctor.chambers.length === 0 && (
            <p className="min-w-0 break-words rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              This doctor has not published any chamber details yet.
            </p>
          )}
        </div>
      </section>
    </MarketingShell>
  );
}
