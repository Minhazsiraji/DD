import { MarketingPage } from "@/components/marketing/marketing-shell";
import { publicPageMetadata } from "@/lib/seo";

const description =
  "Doctor's Diary editorial policy for product documentation, professional workflow education and patient/clinical education.";

export const metadata = publicPageMetadata({
  title: "Editorial Policy",
  description,
  path: "/editorial-policy",
});

export default function EditorialPolicyPage() {
  return (
    <MarketingPage
      eyebrow="Editorial policy"
      title="Different kinds of content require different kinds of review."
      intro="Doctor's Diary separates product documentation, professional workflow education and patient/clinical education so publication authority is explicit rather than inferred."
    >
      <div className="space-y-6">
        <section className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold">PRODUCT</h2>
          <p className="mt-3 leading-7 text-ink-secondary">Product features, Doctor’s Diary workflows, software usage, security/privacy behavior, booking and public-profile documentation require product/technical review.</p>
        </section>
        <section className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold">PROFESSIONAL_WORKFLOW</h2>
          <p className="mt-3 leading-7 text-ink-secondary">Consultation documentation, prescription workflow structure, investigations workflow, follow-up documentation, record structure, RBAC and audit concepts require product/technical review and clinician review whenever clinical claims are present.</p>
        </section>
        <section className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold">PATIENT_CLINICAL</h2>
          <p className="mt-3 leading-7 text-ink-secondary">Patient education, medical concepts or content that could affect health decisions requires a verified clinician reviewer and authoritative evidence before publication.</p>
        </section>
        <section className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold">AI does not create publication authority</h2>
          <p className="mt-3 leading-7 text-ink-secondary">AI may assist drafting or editing, but generated material does not become public automatically. Editorial approval remains an explicit human-controlled step, and private patient data is never an allowed source for public knowledge content.</p>
        </section>
      </div>
    </MarketingPage>
  );
}
