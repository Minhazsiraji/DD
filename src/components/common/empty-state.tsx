import * as React from "react";
import { cn } from "@/lib/utils";
import { IconOrb } from "@/components/common/icon-orb";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** `inline` sits inside a card section; `page` fills a route. */
  variant?: "inline" | "page";
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant = "inline",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        variant === "page" ? "min-h-[46vh] py-16" : "py-10",
        className,
      )}
    >
      <IconOrb accent="brand" size="xl">
        {icon}
      </IconOrb>
      <p className="mt-4 text-[15px] font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-ink-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
