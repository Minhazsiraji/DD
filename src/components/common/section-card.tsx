import * as React from "react";
import { cn } from "@/lib/utils";

/** Clinical sections use the approved milky liquid card shell while keeping the
 * reading area near-solid for contrast. */
export function SectionCard({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("clinical-surface liquid-clinical-card min-w-0 rounded-glass-lg shadow-soft", className)}
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
        "flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-hairline bg-white/28 px-4 py-3.5 sm:flex-nowrap sm:px-5",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {icon ? (
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft/80 text-brand shadow-[inset_0_1px_0_rgb(255_255_255/0.85)]">
            {icon}
          </span>
        ) : null}
        <h2 className="min-w-0 break-words text-[15px] font-semibold tracking-[-0.01em] text-ink sm:truncate">
          {title}
        </h2>
        {typeof count === "number" ? (
          <span className="shrink-0 rounded-full border border-white/70 bg-white/62 px-2 py-0.5 text-xs font-semibold text-ink-secondary shadow-[inset_0_1px_0_white] tabular-nums">
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
