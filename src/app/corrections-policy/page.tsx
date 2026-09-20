import { MarketingPage } from "@/components/marketing/marketing-shell";
import { publicPageMetadata } from "@/lib/seo";

const description =
  "Doctor's Diary corrections policy for public product, workflow and reviewed medical content.";

export const metadata = publicPageMetadata({
  title: "Corrections Policy",
  description,
  path: "/corrections-policy",
});

export default function CorrectionsPolicyPage() {
  return (
    <MarketingPage
      eyebrow="Corrections policy"
      title="Public information should be corrected transparently when it becomes inaccurate."
      intro="Doctor's Diary treats product changes, evidence changes and factual errors as reasons to re-review public content rather than silently preserving stale guidance."
    >
      <div className="space-y-6">
        <section className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold">What triggers review</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-7 text-ink-secondary">
            <li>A material product behavior changes.</li>
            <li>A factual error is confirmed.</li>
            <li>A cited guideline or authoritative source changes materially.</li>
            <li>A reviewer identifies content that no longer meets the medical-content policy.</li>
          </ul>
        </section>
        <section className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold">How changes are handled</h2>
          <p className="mt-3 leading-7 text-ink-secondary">Minor clarity edits may update the last-reviewed date. Material corrections should update the content, references and review record together. Content that cannot be supported safely should be unpublished until corrected rather than left public for traffic or citation continuity.</p>
        </section>
      </div>
    </MarketingPage>
  );
}
