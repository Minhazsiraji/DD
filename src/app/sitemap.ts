import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const configuredBase = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configuredBase && process.env.VERCEL_ENV === "production") {
    throw new Error("NEXT_PUBLIC_SITE_URL is required in Production.");
  }
  const base = configuredBase ?? "http://localhost:3000";
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
