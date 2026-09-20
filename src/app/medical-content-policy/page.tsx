import { MarketingPage } from "@/components/marketing/marketing-shell";
import { publicPageMetadata } from "@/lib/seo";

const description =
  "Doctor's Diary medical-content policy for evidence quality, clinician review and the boundary between education and individualized medical advice.";

export const metadata = publicPageMetadata({
  title: "Medical Content Policy",
  description,
  path: "/medical-content-policy",
});

export default function MedicalContentPolicyPage() {
  return (
    <MarketingPage
      eyebrow="Medical content policy"
      title="Clinical and patient-facing claims require evidence and accountable review."
      intro="Doctor's Diary does not treat search traffic or AI citation as a reason to lower medical-content standards."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <section className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold">Evidence preference</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 leading-7 text-ink-secondary">
            <li>WHO and recognized public-health authorities.</li>
            <li>Bangladesh DGHS, DGDA or the appropriate national authority.</li>
            <li>Recognized professional medical societies.</li>
            <li>Current recognized clinical guidelines.</li>
            <li>High-quality peer-reviewed reviews and primary literature where appropriate.</li>
            <li>Authoritative academic or institutional sources.</li>
          </ol>
        </section>
        <section className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold">Never fabricate</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7 text-ink-secondary">
            <li>Medical claims or statistics.</li>
            <li>References or guideline recommendations.</li>
            <li>Reviewer names, credentials or affiliations.</li>
            <li>Clinical certainty that the source material does not support.</li>
          </ul>
        </section>
      </div>
      <section className="mt-6 dd-material-record dd-record-pearl p-6">
        <h2 className="text-xl font-semibold">Reviewer requirement</h2>
        <p className="mt-3 leading-7 text-ink-secondary">A reviewer is not displayed until identity is verified, credentials are verified and explicit consent is recorded. Having a public Doctor’s Diary doctor profile does not automatically make a doctor an editorial reviewer.</p>
        <p className="mt-3 leading-7 text-ink-secondary">Patient-facing educational material is educational information, not individualized diagnosis or treatment advice. Content that could affect health decisions remains unpublished until the required medical review and evidence are present.</p>
      </section>
    </MarketingPage>
  );
}
