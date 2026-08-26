import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = { title: "Pricing" };

const included = [
  "Doctor workspace",
  "Patient history and return visits",
  "Prescription review/finalization/print",
  "Professional profile",
  "Multi-chamber support",
  "Early booking access as it becomes available",
  "High-touch founding-doctor onboarding",
];

export default function PricingPage() {
  return (
    <MarketingPage eyebrow="Founding Doctor" title="Start with the product. Prove the value. Then pay to keep it." intro="Exact paid pricing will be finalized from pilot evidence. The commercial model is intentionally configurable instead of hard-coding an unvalidated number into the product.">
      <div className="grid gap-6 lg:grid-cols-[1fr_.8fr]">
        <article className="rounded-[2rem] border border-teal-200 bg-white p-7 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-teal-700">Founding Doctor</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Early-user plan</h2>
            </div>
            <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">Pilot → paid transition</span>
          </div>
          <p className="mt-5 leading-7 text-slate-600">For the first cohort of doctors helping validate the real consultation workflow. Founding terms can include a defined early-user discount period without trapping clinical data behind billing.</p>
          <ul className="mt-6 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            {included.map((item) => <li key={item} className="rounded-xl bg-slate-50 px-4 py-3">✓ {item}</li>)}
          </ul>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white">Join the pilot</Link>
            <Link href="/contact" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-800">Request a demo</Link>
          </div>
        </article>
        <aside className="rounded-[2rem] bg-slate-950 p-7 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-300">Billing principle</p>
          <h2 className="mt-3 text-2xl font-semibold">Clinical history is not held hostage by subscription status.</h2>
          <p className="mt-4 leading-7 text-slate-300">Plans control product access and entitlements. Ending a subscription must not rewrite, delete or invalidate finalized clinical records.</p>
        </aside>
      </div>
    </MarketingPage>
  );
}
