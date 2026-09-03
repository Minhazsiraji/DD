import type { Metadata } from "next";
import Link from "next/link";
import {
  ListChecks,
  Printer,
  Pill,
  FileText,
  CircleDollarSign,
  Sparkles,
  Settings,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "More" };

const items = [
  { href: "/queue", label: "Live queue", description: "See arrived and waiting patients", icon: ListChecks },
  { href: "/handover", label: "Prescription handover", description: "Print or hand over finalized prescriptions", icon: Printer },
  { href: "/medicines", label: "Medicines", description: "Open medicine tools and references", icon: Pill },
  { href: "/documents", label: "Documents", description: "Lab, imaging and uploaded documents", icon: FileText },
  { href: "/payments", label: "Payments", description: "Operational payment records", icon: CircleDollarSign },
  { href: "/assistant", label: "AI Assistant", description: "Open the existing assistant workspace", icon: Sparkles },
  { href: "/settings", label: "Settings", description: "Profile, chamber and product preferences", icon: Settings },
] as const;

export default function Page() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="More"
        subtitle="Less-frequent tools stay here so the doctor’s primary navigation remains focused."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="dd-public-card group flex min-h-[126px] items-start gap-3.5 rounded-[22px] p-4 focus-visible:focus-ring sm:p-5"
            >
              <span className="dd-feature-icon inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] text-brand">
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">{item.label}</span>
                <span className="mt-1 block text-[12.5px] leading-5 text-ink-secondary">{item.description}</span>
              </span>
              <ChevronRight className="mt-1 size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
