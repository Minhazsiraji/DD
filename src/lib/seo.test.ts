import { afterEach, describe, expect, it } from "vitest";
import {
  SEARCH_BRAND_NAME,
  SITE_ORIGIN,
  canonicalUrl,
  doctorProfileJsonLd,
  publicPageMetadata,
  searchRobots,
  serializeJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "./seo";

const originalVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("SEO metadata", () => {
  it("builds production-origin self canonicals and branded social metadata", () => {
    const metadata = publicPageMetadata({
      title: "Features",
      description: "Feature description",
      path: "/features",
    });

    expect(metadata.alternates).toEqual({ canonical: `${SITE_ORIGIN}/features` });
    expect(metadata.openGraph).toMatchObject({
      siteName: SEARCH_BRAND_NAME,
      url: `${SITE_ORIGIN}/features`,
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("never creates a Vercel Preview canonical", () => {
    process.env.VERCEL_ENV = "preview";
    expect(canonicalUrl("/for-doctors")).toBe(`${SITE_ORIGIN}/for-doctors`);
  });

  it("fails closed outside Production and for ineligible profiles", () => {
    process.env.VERCEL_ENV = "preview";
    expect(searchRobots(true)).toEqual({ index: false, follow: false });

    process.env.VERCEL_ENV = "production";
    expect(searchRobots(false)).toEqual({ index: false, follow: false });
    expect(searchRobots(true)).toEqual({ index: true, follow: true });
  });
});

describe("SEO structured data", () => {
  it("uses the approved differentiated brand without fabricated commercial claims", () => {
    expect(websiteJsonLd()).toMatchObject({
      "@type": "WebSite",
      name: SEARCH_BRAND_NAME,
      url: SITE_ORIGIN,
    });
    expect(softwareApplicationJsonLd()).toMatchObject({
      "@type": "SoftwareApplication",
      name: "Doctor's Diary",
      alternateName: SEARCH_BRAND_NAME,
    });
  });

  it("builds ProfilePage and Person data only from public profile inputs", () => {
    const value = doctorProfileJsonLd({
      fullName: "Dr Example",
      slug: "dr-example",
      qualification: "MBBS",
      designation: "Consultant",
      specialization: "Medicine",
    });

    expect(value).toMatchObject({
      "@type": "ProfilePage",
      url: `${SITE_ORIGIN}/dr/dr-example`,
      mainEntity: {
        "@type": "Person",
        name: "Dr Example",
        jobTitle: "Consultant",
        hasCredential: "MBBS",
        knowsAbout: "Medicine",
      },
    });
    expect(serializeJsonLd(value)).not.toContain("<");
  });
});
