import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const production = process.env.VERCEL_ENV === "production";
  if (!production) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/features",
        "/how-it-works",
        "/pricing",
        "/security",
        "/faq",
        "/contact",
        "/about",
        "/for-doctors",
        "/dr/",
      ],
      disallow: ["/dashboard", "/patients", "/appointments", "/settings", "/api/"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
