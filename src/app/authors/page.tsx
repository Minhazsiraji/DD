import Link from "next/link";
import { MarketingPage } from "@/components/marketing/marketing-shell";
import { PUBLIC_AUTHORS } from "@/lib/knowledge";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Authors",
  description: "Public author and publisher identities used by Doctor's Diary knowledge content.",
  path: "/authors",
});

export default function AuthorsPage() {
  return (
    <MarketingPage
      eyebrow="Authors"
      title="Accountable source identity for public knowledge content."
      intro="Author pages identify who is responsible for the public content. Reviewer status is separate and requires its own verification."
    >
      <div className="grid gap-5 md:grid-cols-2">
        {PUBLIC_AUTHORS.map((author) => (
          <article key={author.slug} className="dd-material-record dd-record-pearl p-6">
            <h2 className="text-xl font-semibold">{author.name}</h2>
            <p className="mt-2 text-sm text-brand">{author.role}</p>
            <p className="mt-3 leading-7 text-ink-secondary">{author.bio}</p>
            <Link href={`/authors/${author.slug}`} className="mt-5 inline-flex min-h-11 items-center font-semibold text-brand">View author page</Link>
          </article>
        ))}
      </div>
    </MarketingPage>
  );
}
