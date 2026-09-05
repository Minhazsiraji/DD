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
            "liquid-primary flex size-14 -translate-y-4 items-center justify-center rounded-full transition-transform active:scale-95 focus-visible:focus-ring",
            className,
          )}
        >
          <Plus className="size-6" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            "liquid-primary inline-flex h-11 items-center gap-2 rounded-full px-5 text-[13px] font-semibold text-white transition-transform active:scale-95 focus-visible:focus-ring",
            className,
          )}
        >
          <Plus className="size-4" aria-hidden="true" />
          New
          <span className="ml-0.5 flex size-6 items-center justify-center rounded-full bg-white/14 ring-1 ring-white/24" aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </span>
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="glass-strong max-h-[88dvh] rounded-t-[26px] border-glass-border p-0 sm:inset-y-0 sm:right-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-sm sm:rounded-none sm:rounded-l-[26px]"
        >
          <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-ink-muted/30" />
          </div>

          <SheetHeader className="gap-1 px-5 pt-3 pb-1 text-left">
            <SheetTitle className="text-ink">Quick actions</SheetTitle>
            <SheetDescription className="text-ink-secondary">Start a common task.</SheetDescription>
          </SheetHeader>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <ul className="space-y-2">
              {QUICK_ACTIONS.map((action) => (
                <li key={action.href}>
                  <Link
                    href={action.href}
                    onClick={() => setOpen(false)}
                    className="liquid-secondary flex min-h-14 items-center gap-3 rounded-[18px] px-3 py-2.5 transition-transform hover:-translate-y-px focus-visible:focus-ring"
                  >
                    <IconOrb accent={action.accent} size="md">{action.icon}</IconOrb>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{action.label}</span>
                      <span className="block truncate text-xs text-ink-secondary">{action.description}</span>
                    </span>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/48 shadow-[inset_0_1px_0_white]" aria-hidden="true">
                      <ChevronRight className="size-4 text-brand" />
                    </span>
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
