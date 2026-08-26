import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <MarketingPage eyebrow="Contact" title="Start with a real workflow conversation." intro="For the first founding doctors, onboarding is intentionally high-touch. We want to understand what consumes time in your current consultation before asking you to change it.">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-7">
        <h2 className="text-xl font-semibold">Ready to try Doctor&apos;s Diary?</h2>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">Create an account for the pilot or sign in if your doctor workspace is already prepared.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/signup" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white">Start free</Link>
          <Link href="/login" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-800">Sign in</Link>
        </div>
      </div>
    </MarketingPage>
  );
}
