import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The dev indicator renders bottom-left, directly on top of the mobile bottom
   * navigation's "Home" tab, which makes the nav impossible to judge or tap
   * while testing at phone widths. Off.
   */
  devIndicators: false,
};

export default nextConfig;
