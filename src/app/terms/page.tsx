import { MarketingPage } from "@/components/marketing/marketing-shell";

export default function TermsPage() {
  return <MarketingPage eyebrow="Terms" title="Terms & Conditions" intro="Core terms for using the Doctor's Diary service.">
    <div className="grid gap-6 text-ink-secondary">
      <p>Doctor&apos;s Diary supports clinical documentation and practice workflows. It does not replace a doctor&apos;s professional judgment, and the treating doctor remains responsible for reviewing and approving clinical decisions and records.</p>
      <p>Users must protect their account access, use the service only with appropriate authority, and enter or access patient information only for legitimate care and practice purposes.</p>
      <p>Features, pilot availability, and commercial terms may change as the service develops. Any applicable plan or payment terms shown at signup or agreed separately form part of the service arrangement.</p>
      <p>For questions about these terms, contact <a className="text-brand hover:underline" href="mailto:business@agentsiraji.com">business@agentsiraji.com</a>.</p>
    </div>
  </MarketingPage>;
}
