import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Document uploads are validated to a 10 MB maximum in application code.
  // Next.js Server Actions default to 1 MB, so permit the feature's declared limit.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  /**
   * The dev indicator renders bottom-left, directly on top of the mobile bottom
   * navigation's "Home" tab, which makes the nav impossible to judge or tap
   * while testing at phone widths. Off.
   */
  devIndicators: false,
};

export default nextConfig;
