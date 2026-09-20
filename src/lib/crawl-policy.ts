import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "./seo";

export const SEARCH_CRAWLERS = ["OAI-SearchBot", "Googlebot", "Bingbot"] as const;
export const TRAINING_CRAWLERS = ["GPTBot", "Google-Extended"] as const;

export const PUBLIC_CRAWL_PATHS = [
  "/",
  "/features",
  "/how-it-works",
  "/pricing",
  "/security",
  "/faq",
  "/contact",
  "/about",
  "/for-doctors",
  "/learn",
  "/editorial-policy",
  "/medical-content-policy",
  "/corrections-policy",
  "/authors",
  "/reviewers",
  "/dr/",
] as const;

export const PRIVATE_CRAWL_PATHS = [
  "/dashboard",
  "/patients",
  "/appointments",
  "/assistant",
  "/consultation",
  "/documents",
  "/followups",
  "/handover",
  "/medicines",
  "/more",
  "/owner",
  "/payments",
  "/prescription",
  "/queue",
  "/reports",
  "/settings",
  "/onboarding",
  "/dev",
  "/staff",
  "/admin",
  "/profile",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/",
  "/api/",
] as const;

export function buildRobots(production: boolean): MetadataRoute.Robots {
  if (!production) return { rules: { userAgent: "*", disallow: "/" } };

  const searchRule = {
    allow: [...PUBLIC_CRAWL_PATHS],
    disallow: [...PRIVATE_CRAWL_PATHS],
  };

  return {
    rules: [
      ...SEARCH_CRAWLERS.map((userAgent) => ({ userAgent, ...searchRule })),
      ...TRAINING_CRAWLERS.map((userAgent) => ({ userAgent, disallow: "/" })),
      { userAgent: "*", ...searchRule },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
