import type { MetadataRoute } from "next";
import { getSearchIndexableDoctorSlugs } from "@/features/public-booking/queries";
import { SITE_ORIGIN } from "@/lib/seo";

const STATIC_PUBLIC_PATHS = [
  "",
  "/features",
  "/how-it-works",
  "/pricing",
  "/security",
  "/faq",
  "/contact",
  "/about",
  "/for-doctors",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_PUBLIC_PATHS.map((path) => ({
    url: new URL(path || "/", SITE_ORIGIN).toString(),
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));

  const slugs = await getSearchIndexableDoctorSlugs();
  const doctorEntries: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: new URL(`/dr/${encodeURIComponent(slug)}`, SITE_ORIGIN).toString(),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticEntries, ...doctorEntries];
}
