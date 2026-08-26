import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = { title: "FAQ" };

const faq = [
  ["Is Doctor’s Diary only prescription software?", "No. Prescription is one part of a doctor productivity workflow that also keeps patient history, consultations, chambers, appointments and continuity together."],
  ["Does AI finalize prescriptions?", "No. The product direction is AI-prepared, doctor-reviewed and doctor-finalized."],
  ["Can one doctor work at multiple chambers?", "Yes. The clinical repository follows the doctor while location-specific schedules and paper identity can remain chamber-aware."],
  ["Is the professional profile automatically public?", "No. Private is the default. Public visibility must be an explicit doctor choice."],
  ["Is BMDC currently verified by Doctor’s Diary?", "Not yet. A registration number may be recorded, but the product must not present a verified badge until a real verification process exists."],
];

export default function FaqPage() {
  return (
    <MarketingPage eyebrow="FAQ" title="Questions doctors should ask before trusting new clinical software." intro="Clear answers matter more than feature claims.">
      <div className="grid gap-4">
        {faq.map(([q, a]) => (
          <article key={q} className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold">{q}</h2>
            <p className="mt-3 leading-7 text-slate-600">{a}</p>
          </article>
        ))}
      </div>
    </MarketingPage>
  );
}
