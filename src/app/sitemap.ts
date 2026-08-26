import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://dd-sigma-vert.vercel.app";
  return [
    "",
    "/features",
    "/how-it-works",
    "/pricing",
    "/security",
    "/faq",
    "/contact",
  ].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
