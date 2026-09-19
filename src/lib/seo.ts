import type { Metadata } from "next";

export const SITE_ORIGIN = "https://dd.agentsiraji.com";
export const PRODUCT_NAME = "Doctor's Diary";
export const SEARCH_BRAND_NAME = "Doctor's Diary by AgentSiraji";
export const DEFAULT_DESCRIPTION =
  "Doctor's Diary is a doctor productivity workspace for patient history, consultations, prescriptions, chambers and follow-up — built for less typing, less searching and more patient time.";

export function canonicalUrl(path = "/"): string {
  return new URL(path, SITE_ORIGIN).toString();
}

export function isProductionIndexable(eligible = true): boolean {
  return process.env.VERCEL_ENV === "production" && eligible;
}

export function publicPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const canonical = canonicalUrl(path);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${title} · ${SEARCH_BRAND_NAME}`,
      description,
      type: "website",
      url: canonical,
      siteName: SEARCH_BRAND_NAME,
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: SEARCH_BRAND_NAME }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} · ${SEARCH_BRAND_NAME}`,
      description,
      images: ["/opengraph-image"],
    },
  };
}

export function searchRobots(eligible: boolean): Metadata["robots"] {
  return isProductionIndexable(eligible)
    ? { index: true, follow: true }
    : { index: false, follow: false };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SEARCH_BRAND_NAME,
    alternateName: PRODUCT_NAME,
    url: SITE_ORIGIN,
    description: DEFAULT_DESCRIPTION,
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "AgentSiraji",
  };
}

export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PRODUCT_NAME,
    alternateName: SEARCH_BRAND_NAME,
    url: SITE_ORIGIN,
    description: DEFAULT_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    publisher: {
      "@type": "Organization",
      name: "AgentSiraji",
    },
  };
}

export function doctorProfileJsonLd(doctor: {
  fullName: string;
  slug: string;
  qualification: string | null;
  designation: string | null;
  specialization: string | null;
}) {
  const url = canonicalUrl(`/dr/${encodeURIComponent(doctor.slug)}`);
  const person: Record<string, unknown> = {
    "@type": "Person",
    name: doctor.fullName,
    url,
  };

  if (doctor.designation) person.jobTitle = doctor.designation;
  if (doctor.qualification) person.hasCredential = doctor.qualification;
  if (doctor.specialization) person.knowsAbout = doctor.specialization;

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    name: `${doctor.fullName} · ${SEARCH_BRAND_NAME}`,
    mainEntity: person,
  };
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
