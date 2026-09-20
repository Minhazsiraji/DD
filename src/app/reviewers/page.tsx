import Link from "next/link";
import { MarketingPage } from "@/components/marketing/marketing-shell";
import { PUBLIC_REVIEWERS, isVerifiedReviewer } from "@/lib/knowledge";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Medical Reviewers",
  description: "Verified medical reviewers for Doctor's Diary public clinical and patient-education content.",
  path: "/reviewers",
});

export default function ReviewersPage() {
  const reviewers = PUBLIC_REVIEWERS.filter(isVerifiedReviewer);

  return (
    <MarketingPage
      eyebrow="Medical reviewers"
      title="Reviewer attribution is published only after verification and consent."
      intro="Doctor's Diary requires verified identity, verified credentials and explicit consent before a clinician appears as a public editorial reviewer."
    >
      {reviewers.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2">
          {reviewers.map((reviewer) => (
            <article key={reviewer.slug} className="dd-material-record dd-record-pearl p-6">
              <h2 className="text-xl font-semibold">{reviewer.name}</h2>
              <p className="mt-3 leading-7 text-ink-secondary">{reviewer.bio}</p>
              <Link href={`/reviewers/${reviewer.slug}`} className="mt-5 inline-flex min-h-11 items-center font-semibold text-brand">View reviewer</Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="dd-material-record dd-record-pearl max-w-3xl p-6">
          <h2 className="text-xl font-semibold">No public medical reviewer is currently listed.</h2>
          <p className="mt-3 leading-7 text-ink-secondary">This is intentional and fail-closed. No identity or credential is invented to make content appear reviewed. Patient/clinical articles that require medical review stay unpublished until a qualifying reviewer is verified and consents.</p>
        </div>
      )}
    </MarketingPage>
  );
}
