import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SectionCard — the opaque counterpart to GlassCard.
 *
 * This is the ONLY surface clinical content may render on: vitals, lab values,
 * prescriptions, dose tables, diagnosis text, and any dense form. Readability
 * beats aesthetics wherever a misread could affect a patient.
 */
export function SectionCard({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("clinical-surface rounded-glass-lg shadow-soft", className)}
      {...props}
    />
  );
}

interface SectionHeaderProps extends React.ComponentProps<"div"> {
  title: string;
  count?: number;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function SectionHeader({
  title,
  count,
  icon,
  action,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <span className="shrink-0 text-brand">{icon}</span> : null}
        <h2 className="truncate text-[15px] font-semibold text-ink">{title}</h2>
        {typeof count === "number" ? (
          <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary tabular-nums">
            {count}
          </span>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
