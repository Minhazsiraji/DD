import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { PRIMARY_NAV, SECONDARY_NAV, VOICE_GUIDE_NAV } from "@/components/layout/nav-config";

export const metadata: Metadata = { title: "More" };

export default function Page() {
  const bottomRoutes = new Set(["/dashboard", "/patients", "/appointments", "/more"]);
  const overflow = PRIMARY_NAV.filter((item) => !bottomRoutes.has(item.href));
  const items = [
    ...overflow,
    VOICE_GUIDE_NAV,
    { href: "/assistant", label: "AI Assistant", icon: <Sparkles className="size-[18px]" /> },
    ...SECONDARY_NAV,
  ];
  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="More"
        subtitle="The rest of your Doctor's Diary workspace."
      />
      <SectionCard className="overflow-hidden p-2 sm:p-3">
        <ul className="grid min-w-0 gap-1 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-12 min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-secondary transition-colors hover:bg-white/60 hover:text-ink focus-visible:focus-ring"
              >
                <span className="shrink-0 text-brand" aria-hidden="true">{item.icon}</span>
                <span className="min-w-0 truncate">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
