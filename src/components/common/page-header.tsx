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
        "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
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
        <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-ink sm:truncate sm:text-[28px]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 break-words text-sm text-ink-secondary">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
