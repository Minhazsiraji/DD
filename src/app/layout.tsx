import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import {
  DEFAULT_DESCRIPTION,
  PRODUCT_NAME,
  SEARCH_BRAND_NAME,
  SITE_ORIGIN,
  organizationJsonLd,
  serializeJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "@/lib/seo";
import "./globals.css";
import "./branding-logo.css";
import "./canonical-brand.css";
import "./global-background-test.css";
import "./app-unified-liquid.css";
import "./dd-material-system.css";

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
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: "Doctor's Diary by AgentSiraji",
    template: "%s · Doctor's Diary by AgentSiraji",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    title: SEARCH_BRAND_NAME,
    description: DEFAULT_DESCRIPTION,
    type: "website",
    url: "/",
    siteName: SEARCH_BRAND_NAME,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: SEARCH_BRAND_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEARCH_BRAND_NAME,
    description: DEFAULT_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  appleWebApp: {
    capable: true,
    title: PRODUCT_NAME,
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
      <body className="min-h-full">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd()) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationJsonLd()) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(softwareApplicationJsonLd()) }} />
        {children}
      </body>
    </html>
  );
}
