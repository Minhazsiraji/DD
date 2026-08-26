import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = { title: "How it works" };

const steps = [
  ["1", "Prepare", "Find the patient, see previous context and start from the correct chamber."],
  ["2", "Consult", "Record only what is needed for today. Previous observations stay context, not silent carry-forward."],
  ["3", "Prescribe", "Add medicines, investigations and advice using the doctor’s own workflow."],
  ["4", "Review", "The doctor reviews the complete prescription before anything becomes final."],
  ["5", "Finalize", "Finalized prescriptions are protected from silent mutation and retain controlled correction lineage."],
  ["6", "Remember", "When the patient returns, the history is available without overwriting the new visit."],
];

export default function HowItWorksPage() {
  return (
    <MarketingPage eyebrow="How it works" title="From patient context to a safe final prescription." intro="The workflow is designed around the doctor’s decision-making instead of forcing the doctor to become a data-entry operator.">
      <div className="grid gap-4">
        {steps.map(([n, title, body]) => (
          <article key={n} className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 sm:grid-cols-[3rem_1fr]">
            <span className="grid size-12 place-items-center rounded-2xl bg-teal-50 font-semibold text-teal-700">{n}</span>
            <div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-2 leading-7 text-slate-600">{body}</p>
            </div>
          </article>
        ))}
      </div>
    </MarketingPage>
  );
}
