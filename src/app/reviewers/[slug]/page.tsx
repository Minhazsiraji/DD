import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingPage } from "@/components/marketing/marketing-shell";
import { PUBLIC_REVIEWERS, getReviewer, isVerifiedReviewer } from "@/lib/knowledge";
import { publicPageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return PUBLIC_REVIEWERS.filter(isVerifiedReviewer).map((reviewer) => ({ slug: reviewer.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const reviewer = getReviewer(slug);
  if (!isVerifiedReviewer(reviewer) || !reviewer) return { robots: { index: false, follow: false } };
  return publicPageMetadata({
    title: reviewer.name,
    description: reviewer.bio,
    path: `/reviewers/${reviewer.slug}`,
  });
}

export default async function ReviewerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const reviewer = getReviewer(slug);
  if (!isVerifiedReviewer(reviewer) || !reviewer) notFound();

  return (
    <MarketingPage eyebrow="Medical reviewer" title={reviewer.name} intro={reviewer.bio}>
      <div className="dd-material-record dd-record-pearl max-w-3xl p-6">
        <h2 className="text-xl font-semibold">Verified credentials</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-secondary">
          {reviewer.credentials.map((credential) => <li key={credential}>{credential}</li>)}
        </ul>
        <p className="mt-4 text-sm text-ink-secondary">Identity verified · credentials verified · publication consent recorded.</p>
      </div>
    </MarketingPage>
  );
}
