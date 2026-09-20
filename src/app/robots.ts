import type { MetadataRoute } from "next";
import { buildRobots } from "@/lib/crawl-policy";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(process.env.VERCEL_ENV === "production");
}
