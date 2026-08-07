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

/**
 * QuickActionMenu — the central "+" of the mobile bottom bar, and a normal
 * button on desktop.
 *
 * Rows are 56px tall: comfortably above the 44px minimum target, because this
 * is used one-handed, standing, mid-clinic.
 */
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
            "icon-orb orb-brand size-14 -translate-y-4 shadow-float transition-transform active:scale-95 focus-visible:focus-ring",
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
            "inline-flex h-10 items-center gap-2 rounded-full bg-[image:var(--grad-brand)] px-4 text-sm font-semibold text-white shadow-[0_6px_16px_rgb(var(--glow-brand)/0.34)] transition-transform hover:-translate-y-px active:scale-95 focus-visible:focus-ring",
            className,
          )}
        >
          <Plus className="size-4" aria-hidden="true" />
          New
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="glass-strong max-h-[88dvh] rounded-t-glass-lg border-glass-border p-0 sm:inset-y-0 sm:right-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-sm sm:rounded-none sm:rounded-l-glass-lg"
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
            <ul className="space-y-1">
              {QUICK_ACTIONS.map((action) => (
                <li key={action.href}>
                  <Link
                    href={action.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/70 focus-visible:focus-ring"
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
