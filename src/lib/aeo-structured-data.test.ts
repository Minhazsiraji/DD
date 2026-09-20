import { describe, expect, it } from "vitest";
import { getAuthor, getKnowledgeArticles } from "./knowledge";
import { SITE_ORIGIN, articleJsonLd, breadcrumbJsonLd, serializeJsonLd } from "./seo";

describe("AEO/GEO structured data", () => {
  it("describes visible article content with Article schema", () => {
    const article = getKnowledgeArticles({ productionOnly: false })[0];
    const author = getAuthor(article.authorSlug);
    expect(author).toBeDefined();
    if (!author) throw new Error("Expected article author");

    const path = `/learn/${article.audience}/${article.slug}`;
    const value = articleJsonLd({ article, path, author });

    expect(value).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.description,
      url: `${SITE_ORIGIN}${path}`,
      datePublished: article.datePublished,
      dateModified: article.dateReviewed,
      author: {
        "@type": "Organization",
        name: "AgentSiraji",
        url: `${SITE_ORIGIN}/authors/agentsiraji`,
      },
    });
    expect(serializeJsonLd(value)).not.toContain("<");
  });

  it("builds BreadcrumbList schema from the visible hierarchy", () => {
    const value = breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Learn", path: "/learn" },
      { name: "Doctors", path: "/learn/doctors" },
    ]);
    expect(value).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Learn", item: `${SITE_ORIGIN}/learn` },
        { "@type": "ListItem", position: 3, name: "Doctors", item: `${SITE_ORIGIN}/learn/doctors` },
      ],
    });
  });
});
