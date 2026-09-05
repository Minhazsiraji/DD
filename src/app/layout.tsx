import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { Inter, Noto_Sans_Bengali, Geist_Mono } from "next/font/google";
import { organBackgroundDataUri } from "@/lib/organ-background";
import "./globals.css";
import "./liquid-ui.css";
import "./clinical-liquid-ui.css";
import "./reference-fidelity.css";
import "./reference-exact-match.css";
import "./reference-content-match.css";
import "./branding-logo.css";
import "./landing-glass-final.css";
import "./phase-b-exact.css";
import "./auth-transparent-test.css";
import "./reference-skin-test.css";
import "./layered-liquid-study.css";
import "./approved-liquid-material.css";
import "./global-background-test.css";
import "./organ-bg-polish.css";
import "./lower-header-rim-exact.css";
import "./canonical-brand.css";
import "./app-unified-liquid.css";

const fontSans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const fontBengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
  weight: ["400", "500", "600", "700"],
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
  themeColor: "#e5dde3",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const organBackgroundStyle = {
    "--dd-organ-bg": `url("${organBackgroundDataUri}")`,
  } as CSSProperties;

  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontBengali.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-full" style={organBackgroundStyle}>
        {children}
      </body>
    </html>
  );
}
