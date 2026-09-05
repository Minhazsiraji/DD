import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared section container. The structural contract is unchanged; the
 * presentation is supplied by the canonical app-wide liquid material layer.
 */
export function SectionCard({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("clinical-surface dd-app-panel min-w-0 rounded-glass-lg shadow-soft", className)}
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
        "dd-section-header flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 sm:flex-nowrap sm:px-5",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {icon ? <span className="shrink-0 text-brand">{icon}</span> : null}
        <h2 className="min-w-0 break-words text-[15px] font-semibold text-ink sm:truncate">{title}</h2>
        {typeof count === "number" ? (
          <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary tabular-nums">
            {count}
          </span>
        ) : null}
      </div>
      {action ? (
        <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{action}</div>
      ) : null}
    </div>
  );
}
