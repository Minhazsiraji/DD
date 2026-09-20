import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingPage } from "@/components/marketing/marketing-shell";
import {
  AUDIENCE_LABELS,
  type KnowledgeAudience,
  getArticlesForAudience,
} from "@/lib/knowledge";
import {
  getProductDiscoveryArticles,
  type ProductDiscoveryArticle,
} from "@/lib/product-discovery";
import { publicPageMetadata } from "@/lib/seo";

const audiences = Object.keys(AUDIENCE_LABELS) as KnowledgeAudience[];

function isAudience(value: string): value is KnowledgeAudience {
  return audiences.includes(value as KnowledgeAudience);
}

function isProductDiscoveryArticle(article: object): article is ProductDiscoveryArticle {
  return "capabilityStatus" in article && "statusDetail" in article;
}

export function generateStaticParams() {
  return audiences.map((audience) => ({ audience }));
}

export async function generateMetadata({ params }: { params: Promise<{ audience: string }> }): Promise<Metadata> {
  const { audience } = await params;
  if (!isAudience(audience)) return {};
  const label = AUDIENCE_LABELS[audience];
  return publicPageMetadata({
    title: `${label} Learning Hub`,
    description: `Doctor's Diary public learning resources for ${label.toLowerCase()}, governed by explicit product, workflow and medical-content review rules.`,
    path: `/learn/${audience}`,
  });
}

export default async function AudienceHub({ params }: { params: Promise<{ audience: string }> }) {
  const { audience } = await params;
  if (!isAudience(audience)) notFound();

  const standardArticles = getArticlesForAudience(audience);
  const discoveryArticles =
    audience === "doctors"
      ? getProductDiscoveryArticles().filter((article) => article.audience === audience)
      : [];
  const articles = [...discoveryArticles, ...standardArticles];
  const label = AUDIENCE_LABELS[audience];

  return (
    <MarketingPage
      eyebrow={`Learn · ${label}`}
      title={`${label} knowledge hub`}
      intro="Each page answers one primary question, keeps its scope explicit and follows the editorial review level required for its content class."
    >
      {articles.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2">
          {articles.map((article) => {
            const capabilityStatus = isProductDiscoveryArticle(article)
              ? article.capabilityStatus
              : undefined;
            return (
              <article key={article.slug} className="dd-material-record dd-record-pearl p-6">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
                  <span>{article.contentClass.replaceAll("_", " ")}</span>
                  {capabilityStatus ? <span aria-label="Current capability status">· {capabilityStatus}</span> : null}
                </div>
                <h2 className="mt-3 text-xl font-semibold text-ink">{article.title}</h2>
                <p className="mt-3 leading-7 text-ink-secondary">{article.description}</p>
                <Link
                  href={`/learn/${article.audience}/${article.slug}`}
                  className="mt-5 inline-flex min-h-11 items-center font-semibold text-brand focus-visible:focus-ring"
                >
                  Read answer
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-xl font-semibold text-ink">No editorially approved articles are live yet.</h2>
          <p className="mt-3 max-w-3xl leading-7 text-ink-secondary">
            Release-candidate drafts remain outside Production until their content-class approval gate is satisfied. Patient/clinical material additionally requires a verified clinician reviewer and authoritative evidence.
          </p>
        </div>
      )}
    </MarketingPage>
  );
}
