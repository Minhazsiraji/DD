import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <MarketingPage eyebrow="Contact" title="Start with a real workflow conversation." intro="For the first founding doctors, onboarding is intentionally high-touch. We want to understand what consumes time in your current consultation before asking you to change it.">
      <div className="dd-material-panel dd-panel-pearl rounded-[2rem] p-7">
        <h2 className="text-xl font-semibold">Ready to try Doctor&apos;s Diary?</h2>
        <p className="mt-3 max-w-2xl leading-7 text-ink-secondary">Create an account for the pilot or sign in if your doctor workspace is already prepared.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/signup" className="dd-primary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring">Start free</Link>
          <Link href="/login" className="dd-secondary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring">Sign in</Link>
        </div>
      </div>
    </MarketingPage>
  );
}
