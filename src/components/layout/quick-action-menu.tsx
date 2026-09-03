"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, ChevronRight } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { IconOrb } from "@/components/common/icon-orb";
import { QUICK_ACTIONS } from "./nav-config";

export function QuickActionMenu({
  variant = "fab",
  className,
}: {
  variant?: "fab" | "button";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {variant === "fab" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Quick actions"
          aria-haspopup="dialog"
          className={cn(
            "dd-primary flex size-13 -translate-y-3 items-center justify-center rounded-full transition-transform active:scale-95 focus-visible:focus-ring",
            className,
          )}
        >
          <Plus className="size-5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            "dd-primary inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-white focus-visible:focus-ring",
            className,
          )}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="glass-strong max-h-[88dvh] rounded-t-[22px] border-glass-border p-0 sm:inset-y-0 sm:right-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-sm sm:rounded-none sm:rounded-l-[22px]"
        >
          <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-ink-muted/30" />
          </div>

          <SheetHeader className="gap-1 px-5 pt-3 pb-1 text-left">
            <SheetTitle className="text-ink">Quick actions</SheetTitle>
            <SheetDescription className="text-ink-secondary">
              Start a common task.
            </SheetDescription>
          </SheetHeader>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <ul className="space-y-1.5">
              {QUICK_ACTIONS.map((action) => (
                <li key={action.href}>
                  <Link
                    href={action.href}
                    onClick={() => setOpen(false)}
                    className="dd-quick-row flex min-h-14 items-center gap-3 rounded-[16px] px-3 py-2.5 focus-visible:focus-ring"
                  >
                    <IconOrb accent={action.accent} size="md">
                      {action.icon}
                    </IconOrb>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">
                        {action.label}
                      </span>
                      <span className="block truncate text-xs text-ink-secondary">
                        {action.description}
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-ink-muted"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
