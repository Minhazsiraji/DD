import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { publicEnv } from "@/lib/env";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PublicDoctorProfile } from "@/features/public-booking/components/public-doctor-profile";
import {
  getPublicDoctor,
  getPublicDoctorPhotoUrl,
} from "@/features/public-booking/queries";

function canonicalProfileUrl(slug: string): URL {
  return new URL(`/dr/${encodeURIComponent(slug)}`, publicEnv().NEXT_PUBLIC_SITE_URL);
}

export async function generateMetadata(props: PageProps<"/dr/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const doctor = await getPublicDoctor(slug);
  if (!doctor) {
    return { title: "Doctor Profile", robots: { index: false, follow: false } };
  }

  const canonical = canonicalProfileUrl(doctor.slug);
  const photoUrl = await getPublicDoctorPhotoUrl(doctor.slug);
  const descriptor = doctor.specialization ?? doctor.designation ?? doctor.qualification ?? "Doctor";
  const description = `${doctor.fullName} · ${descriptor} · Professional profile on Doctor's Diary.`;

  return {
    title: `${doctor.fullName} · Doctor Profile`,
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title: `${doctor.fullName} · Doctor's Diary`,
      description,
      type: "profile",
      url: canonical,
      siteName: "Doctor's Diary",
      images: photoUrl ? [{ url: photoUrl, alt: doctor.fullName }] : undefined,
    },
  };
}

export default async function PublicDoctorPage(props: PageProps<"/dr/[slug]">) {
  const { slug } = await props.params;
  const doctor = await getPublicDoctor(slug);
  if (!doctor) notFound();

  const photoUrl = await getPublicDoctorPhotoUrl(slug);

  return (
    <MarketingShell>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-5 sm:py-12 lg:px-8 lg:py-20">
        <PublicDoctorProfile doctor={doctor} photoUrl={photoUrl} />
      </div>
    </MarketingShell>
  );
}
