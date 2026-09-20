import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import {
  AUDIENCE_LABELS,
  articlePath,
  getAuthor,
  getKnowledgeArticle,
  getKnowledgeArticles,
  getReviewer,
} from "@/lib/knowledge";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  publicPageMetadata,
  serializeJsonLd,
} from "@/lib/seo";

export function generateStaticParams() {
  return getKnowledgeArticles().map((article) => ({
    audience: article.audience,
    slug: article.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ audience: string; slug: string }>;
}): Promise<Metadata> {
  const { audience, slug } = await params;
  const article = getKnowledgeArticle(audience, slug);
  if (!article) return { robots: { index: false, follow: false } };
  return publicPageMetadata({
    title: article.title,
    description: article.description,
    path: articlePath(article),
  });
}

export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ audience: string; slug: string }>;
}) {
  const { audience, slug } = await params;
  const article = getKnowledgeArticle(audience, slug);
  if (!article) notFound();

  const author = getAuthor(article.authorSlug);
  if (!author) notFound();
  const reviewer = getReviewer(article.reviewerSlug);
  const path = articlePath(article);
  const audienceLabel = AUDIENCE_LABELS[article.audience];
  const preview = process.env.VERCEL_ENV !== "production";

  const breadcrumbs = [
    { name: "Home", path: "/" },
    { name: "Learn", path: "/learn" },
    { name: audienceLabel, path: `/learn/${article.audience}` },
    { name: article.title, path },
  ];

  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd({ article, path, author, reviewer })) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd(breadcrumbs)) }}
      />

      <article className="mx-auto max-w-4xl px-5 pb-20 pt-12 lg:px-8 lg:pt-16">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-secondary">
          <ol className="flex flex-wrap gap-2">
            {breadcrumbs.map((item, index) => (
              <li key={item.path} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                <Link href={item.path} className="hover:text-ink">{item.name}</Link>
              </li>
            ))}
          </ol>
        </nav>

        {preview ? (
          <div className="mt-6 rounded-2xl border border-amber-300/70 bg-amber-50/80 p-4 text-sm text-amber-950">
            Preview release candidate — editorial approval is still pending. This article is fail-closed in Production until explicitly approved.
          </div>
        ) : null}

        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.18em] text-brand">
          {article.contentClass.replaceAll("_", " ")}
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{article.question}</h1>
        <div className="mt-6 dd-material-record dd-record-pearl p-6">
          <p className="text-lg font-semibold text-ink">Direct answer</p>
          <p className="mt-3 text-lg leading-8 text-ink-secondary">{article.directAnswer}</p>
        </div>

        <div className="mt-10 space-y-10">
          {article.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-2xl font-semibold text-ink">{section.heading}</h2>
              <div className="mt-4 space-y-4 leading-8 text-ink-secondary">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              {section.bullets ? (
                <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-secondary">
                  {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <section className="mt-12 border-t border-ink/10 pt-8">
          <h2 className="text-2xl font-semibold text-ink">Related questions</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-secondary">
            {article.relatedQuestions.map((question) => <li key={question}>{question}</li>)}
          </ul>
        </section>

        <section className="mt-10 border-t border-ink/10 pt-8">
          <h2 className="text-2xl font-semibold text-ink">References and source context</h2>
          <ul className="mt-4 space-y-3">
            {article.references.map((reference) => (
              <li key={`${reference.href}-${reference.title}`}>
                <Link href={reference.href} className="font-medium text-brand hover:underline">
                  {reference.title}
                </Link>
                <span className="ml-2 text-sm text-ink-secondary">({reference.sourceType.replaceAll("_", " ")})</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-10 dd-material-record dd-record-pearl p-6 text-sm text-ink-secondary">
          <p>
            Author: <Link href={`/authors/${author.slug}`} className="font-semibold text-ink hover:underline">{author.name}</Link>
          </p>
          {reviewer ? (
            <p className="mt-2">
              Medical reviewer: <Link href={`/reviewers/${reviewer.slug}`} className="font-semibold text-ink hover:underline">{reviewer.name}</Link>
            </p>
          ) : null}
          <p className="mt-2">Publication date: {article.datePublished}</p>
          <p className="mt-2">Last reviewed: {article.dateReviewed}</p>
        </footer>
      </article>
    </MarketingShell>
  );
}
