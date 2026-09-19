import Link from "next/link";
import { MarketingPage } from "@/components/marketing/marketing-shell";
import { publicPageMetadata } from "@/lib/seo";

const description =
  "Doctor's Diary by AgentSiraji helps doctors manage consultation history, prescriptions, investigations, follow-up and chamber workflows in one workspace.";

export const metadata = publicPageMetadata({
  title: "For Doctors",
  description,
  path: "/for-doctors",
});

export default function ForDoctorsPage() {
  return (
    <MarketingPage
      eyebrow="For Doctors"
      title="One workspace for the clinical work you repeat every day."
      intro="Doctor’s Diary brings patient continuity, consultation notes, prescription workflows, investigations, follow-up and chamber context together without turning the consultation into extra data entry."
    >
      <div className="grid gap-5 md:grid-cols-3">
        {[
          ["Consult faster", "Keep previous clinical context available while recording today’s findings separately."],
          ["Review before finalizing", "Prepare and review prescription content before the doctor finalizes the clinical record."],
          ["Keep follow-up visible", "Carry forward the information needed for the next visit without merging old findings into the current consultation."],
        ].map(([title, body]) => (
          <article key={title} className="dd-material-record dd-record-pearl p-6">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-3 leading-7 text-ink-secondary">{body}</p>
          </article>
        ))}
      </div>
      <div className="mt-8">
        <Link href="/signup" className="dd-primary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring">
          Start free
        </Link>
      </div>
    </MarketingPage>
  );
}
