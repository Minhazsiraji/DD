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
  "/learn",
  "/learn/doctors",
  "/learn/patients",
  "/learn/medical-students",
  "/editorial-policy",
  "/medical-content-policy",
  "/corrections-policy",
  "/authors",
  "/authors/agentsiraji",
  "/reviewers",
] as const;

export function buildSitemap(
  searchIndexableDoctorSlugs: string[],
  knowledgePaths: string[] = [],
): MetadataRoute.Sitemap {
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

  const knowledgeEntries: MetadataRoute.Sitemap = knowledgePaths.map((path) => ({
    url: new URL(path, SITE_ORIGIN).toString(),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const unique = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const entry of [...staticEntries, ...doctorEntries, ...knowledgeEntries]) unique.set(entry.url, entry);
  return [...unique.values()];
}
