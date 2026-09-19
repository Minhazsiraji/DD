import { MarketingPage } from "@/components/marketing/marketing-shell";
import { publicPageMetadata } from "@/lib/seo";

const description =
  "About Doctor's Diary by AgentSiraji, a doctor-focused workspace for consultations, prescriptions, patient continuity and practice workflows.";

export const metadata = publicPageMetadata({
  title: "About",
  description,
  path: "/about",
});

export default function AboutPage() {
  return (
    <MarketingPage
      eyebrow="About"
      title="A doctor-focused workspace for everyday clinical work."
      intro="Doctor’s Diary is built by AgentSiraji to reduce repetitive clinical administration while keeping the doctor in control of professional and patient records."
    >
      <div className="grid gap-5 md:grid-cols-2">
        <article className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-lg font-semibold">Designed around the consultation</h2>
          <p className="mt-3 leading-7 text-ink-secondary">
            Patient history, current consultation notes, investigations, prescriptions, follow-up and chamber context are organized around the doctor’s workflow.
          </p>
        </article>
        <article className="dd-material-record dd-record-pearl p-6">
          <h2 className="text-lg font-semibold">Doctor-owned professional presence</h2>
          <p className="mt-3 leading-7 text-ink-secondary">
            Public professional profiles are opt-in. Clinical records remain separate from public profile information and are not published as search content.
          </p>
        </article>
      </div>
    </MarketingPage>
  );
}
