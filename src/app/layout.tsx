import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./branding-logo.css";
import "./canonical-brand.css";
import "./global-background-test.css";
import "./app-unified-liquid.css";

/**
 * Fonts are self-hosted by next/font at build time — no runtime request to a
 * font CDN. That is a privacy requirement here, not just a latency one.
 *
 * Phase 8+: when Bangla patient-facing output lands, add a Bangla-capable face
 * as a second variable here rather than reworking the type scale.
 */
const fontSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Doctor's Diary",
    template: "%s · Doctor's Diary",
  },
  description:
    "Doctor's Diary is a doctor productivity workspace for patient history, consultations, prescriptions, chambers and follow-up — built for less typing, less searching and more patient time.",
  applicationName: "Doctor's Diary",
  appleWebApp: {
    capable: true,
    title: "Doctor's Diary",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  robots:
    process.env.VERCEL_ENV === "production"
      ? { index: true, follow: true }
      : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#e4edfd",
  width: "device-width",
  initialScale: 1,
  // Never block zoom: clinicians need to enlarge dose text.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
