import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = { title: "Features" };

const features = [
  ["Patient memory", "Keep previous consultations, prescriptions and investigations available without merging them into today’s findings."],
  ["Consultation workspace", "Vitals, complaint, history, examination, assessment, diagnosis, investigations and advice in one clinical flow."],
  ["Prescription safety", "Review, doctor-only finalization, immutable history, controlled correction/replacement and reliable print/PDF."],
  ["Multi-chamber practice", "The doctor keeps one clinical repository while chamber/location context remains explicit."],
  ["Professional profile", "A doctor-owned professional profile and visiting schedule foundation, with public publishing kept opt-in."],
  ["Staff workflow", "Reception and assistant access can be scoped without giving unrestricted access to private clinical records."],
];

export default function FeaturesPage() {
  return (
    <MarketingPage eyebrow="Features" title="Built to remove work from the doctor." intro="Doctor’s Diary focuses on clinical productivity, continuity and safe final records — not a checklist of disconnected modules.">
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {features.map(([title, body]) => (
          <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-3 leading-7 text-slate-600">{body}</p>
          </article>
        ))}
      </div>
    </MarketingPage>
  );
}
