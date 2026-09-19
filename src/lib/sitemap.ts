import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "./seo";

export const STATIC_PUBLIC_PATHS = [
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

export function buildSitemap(searchIndexableDoctorSlugs: string[]): MetadataRoute.Sitemap {
  const staticEntries: MetadataRoute.Sitemap = STATIC_PUBLIC_PATHS.map((path) => ({
    url: new URL(path || "/", SITE_ORIGIN).toString(),
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));

  const doctorEntries: MetadataRoute.Sitemap = searchIndexableDoctorSlugs.map((slug) => ({
    url: new URL(`/dr/${encodeURIComponent(slug)}`, SITE_ORIGIN).toString(),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticEntries, ...doctorEntries];
}
