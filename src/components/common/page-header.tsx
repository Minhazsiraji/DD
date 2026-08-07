import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps extends React.ComponentProps<"header"> {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}

/**
 * PageHeader — the standard title block for every workspace route.
 * Sits on the page background (no surface of its own) so it never adds a
 * blur layer to the view's budget.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
