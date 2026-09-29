import { MarketingPage } from "@/components/marketing/marketing-shell";

export default function PrivacyPage() {
  return <MarketingPage eyebrow="Privacy" title="Privacy" intro="How Doctor's Diary approaches privacy and data handling.">
    <div className="grid gap-6 text-ink-secondary">
      <p>Doctor&apos;s Diary is designed to keep clinical information within authorized workflows and to limit access according to account, role, and practice permissions.</p>
      <p>Doctors control the clinical information they enter and the public profile information they choose to publish. Public profile fields are separate from private clinical records.</p>
      <p>Operational and security data may be processed as needed to provide, protect, troubleshoot, and improve the service. Doctor&apos;s Diary does not make private patient records public through doctor profiles.</p>
      <p>For privacy questions or requests, contact <a className="text-brand hover:underline" href="mailto:business@agentsiraji.com">business@agentsiraji.com</a>.</p>
    </div>
  </MarketingPage>;
}
