import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing/marketing-shell";

export const metadata: Metadata = { title: "Security & clinical trust" };

export default function SecurityPage() {
  return (
    <MarketingPage eyebrow="Security & clinical trust" title="Clinical safety is an architecture rule, not a marketing badge." intro="Doctor’s Diary is designed around doctor-owned clinical records, explicit staff permissions, trusted finalization and auditable changes.">
      <div className="grid gap-5 md:grid-cols-2">
        {[
          ["Doctor isolation", "Each doctor’s patient repository remains separate. Practice location describes where care happened; it does not merge clinical ownership."],
          ["Trusted finalization", "The browser is not the authority for the immutable prescription. Final output is frozen through trusted server/database boundaries."],
          ["Controlled corrections", "A finalized prescription is not silently edited. Corrections follow explicit replacement lineage."],
          ["Staff boundaries", "Reception and location staff receive only the access their workflow requires."],
          ["Private by default", "Professional profiles remain private unless the doctor explicitly chooses to publish them."],
          ["AI remains draft", "Future AI/Copilot output is prepared for doctor review; AI does not become the final clinical authority."],
        ].map(([title, body]) => (
          <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-3 leading-7 text-slate-600">{body}</p>
          </article>
        ))}
      </div>
    </MarketingPage>
  );
}
