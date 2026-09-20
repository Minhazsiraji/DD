import Link from "next/link";
import { MarketingPage } from "@/components/marketing/marketing-shell";
import { AUDIENCE_LABELS, GATED_PATIENT_CLINICAL_BACKLOG } from "@/lib/knowledge";
import { publicPageMetadata } from "@/lib/seo";

const description =
  "Doctor's Diary learning hub for doctor workflow, patient-facing product information and medical-student workflow education, with explicit editorial and medical-review controls.";

export const metadata = publicPageMetadata({
  title: "Learn",
  description,
  path: "/learn",
});

const summaries = {
  doctors: "Product and professional-workflow guidance on consultations, prescriptions, investigations, follow-up, privacy and safe AI assistance.",
  patients: "Public-profile and booking information, with clinical education withheld until the required reviewer and evidence gates are satisfied.",
  "medical-students": "Documentation and digital-workflow concepts without diagnosis, treatment or dosing instruction.",
} as const;

export default function LearnPage() {
  return (
    <MarketingPage
      eyebrow="Learn"
      title="Clear answers about clinical workflow, product behavior and responsible health information."
      intro="Doctor's Diary separates product documentation, professional workflow education and patient/clinical education so each type of content can follow the right evidence and review standard."
    >
      <div className="grid gap-5 md:grid-cols-3">
        {Object.entries(AUDIENCE_LABELS).map(([audience, label]) => (
          <article key={audience} className="dd-material-record dd-record-pearl p-6">
            <h2 className="text-xl font-semibold text-ink">{label}</h2>
            <p className="mt-3 leading-7 text-ink-secondary">
              {summaries[audience as keyof typeof summaries]}
            </p>
            <Link
              href={`/learn/${audience}`}
              className="mt-5 inline-flex min-h-11 items-center font-semibold text-brand focus-visible:focus-ring"
            >
              Explore {label.toLowerCase()}
            </Link>
          </article>
        ))}
      </div>

      <section className="mt-10 dd-material-record dd-record-pearl p-6">
        <h2 className="text-xl font-semibold text-ink">Medical-content gate</h2>
        <p className="mt-3 max-w-3xl leading-7 text-ink-secondary">
          Patient/clinical content does not become public because it was drafted by AI or added to a backlog. It requires a verified clinician reviewer and authoritative evidence before publication.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-secondary">
          {GATED_PATIENT_CLINICAL_BACKLOG.map((item) => (
            <li key={item.title}>{item.title} — currently withheld pending the required review and evidence.</li>
          ))}
        </ul>
      </section>
    </MarketingPage>
  );
}
