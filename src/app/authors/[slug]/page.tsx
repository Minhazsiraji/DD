import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingPage } from "@/components/marketing/marketing-shell";
import { PUBLIC_AUTHORS, getAuthor } from "@/lib/knowledge";
import { publicPageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return PUBLIC_AUTHORS.map((author) => ({ slug: author.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const author = getAuthor(slug);
  if (!author) return { robots: { index: false, follow: false } };
  return publicPageMetadata({
    title: author.name,
    description: author.bio,
    path: `/authors/${author.slug}`,
  });
}

export default async function AuthorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const author = getAuthor(slug);
  if (!author) notFound();

  return (
    <MarketingPage
      eyebrow="Author"
      title={author.name}
      intro={author.role}
    >
      <div className="dd-material-record dd-record-pearl max-w-3xl p-6">
        <p className="leading-7 text-ink-secondary">{author.bio}</p>
        <p className="mt-4 text-sm text-ink-secondary">Entity type: {author.kind}</p>
        <p className="mt-4 text-sm text-ink-secondary">Medical reviewer status is not implied by authorship. Reviewer attribution, when required, appears separately after verification.</p>
      </div>
    </MarketingPage>
  );
}
