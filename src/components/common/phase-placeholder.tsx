import * as React from "react";
import Link from "next/link";
import { Construction, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";

/**
 * Placeholder for routes the navigation links to but whose module has not been
 * built yet. Keeps every nav target reachable in Phase 1 without pretending the
 * feature exists.
 */
export function PhasePlaceholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={phase} title={title} />
      <SectionCard>
        <EmptyState
          variant="page"
          icon={<Construction className="size-5" />}
          title={`${title} arrives in ${phase}`}
          description={description}
          action={
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to dashboard
            </Link>
          }
        />
      </SectionCard>
    </div>
  );
}
