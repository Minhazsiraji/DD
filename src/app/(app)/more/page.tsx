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

export const metadata: Metadata = { title: "More" };

const ITEMS = [
  {
    href: "/queue",
    label: "Live Queue",
    description: "See waiting patients and start the next consultation.",
    icon: ListChecks,
  },
  {
    href: "/handover",
    label: "Prescription Hand Over",
    description: "Print or hand over finalized prescriptions.",
    icon: Printer,
  },
  {
    href: "/medicines",
    label: "Medicines",
    description: "Open medicine tools and your prescribing workflow helpers.",
    icon: Pill,
  },
  {
    href: "/documents",
    label: "Documents",
    description: "Lab, imaging and uploaded patient documents.",
    icon: FileText,
  },
  {
    href: "/payments",
    label: "Payments",
    description: "Operational payment records for your current workspace.",
    icon: CircleDollarSign,
  },
  {
    href: "/assistant",
    label: "AI Assistant",
    description: "Open AI support. Clinical output remains draft-only.",
    icon: Sparkles,
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Profile, chamber and workspace preferences.",
    icon: Settings,
  },
] as const;

export default function MorePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <p className="text-[13px] font-medium text-brand">Workspace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-ink">More</h1>
        <p className="mt-1 max-w-2xl text-[15px] leading-6 text-ink-secondary">
          Secondary tools stay here so the main navigation remains focused on today&apos;s patient flow.
        </p>
      </header>

      <section className="clinical-surface overflow-hidden rounded-2xl shadow-soft" aria-label="More tools">
        <div className="divide-y divide-hairline">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex min-h-[72px] items-center gap-3 px-4 py-3 transition-colors hover:bg-brand-soft/35 focus-visible:focus-ring sm:px-5"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand ring-1 ring-inset ring-brand/10">
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{item.label}</span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-ink-secondary">{item.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
