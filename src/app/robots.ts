import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const production = process.env.VERCEL_ENV === "production";
  if (!production) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://dd-sigma-vert.vercel.app";
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/features", "/how-it-works", "/pricing", "/security", "/faq", "/contact", "/dr/"],
      disallow: ["/dashboard", "/patients", "/appointments", "/settings", "/api/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
