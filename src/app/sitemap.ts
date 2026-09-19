import type { MetadataRoute } from "next";
import { getSearchIndexableDoctorSlugs } from "@/features/public-booking/queries";
import { buildSitemap } from "@/lib/sitemap";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getSearchIndexableDoctorSlugs();
  return buildSitemap(slugs);
}
