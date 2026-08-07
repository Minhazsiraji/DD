"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface ResponsiveSheetProps {
  trigger: React.ReactNode;
  title: string;
  /** Screen-reader description. Required — the sheet is a dialog. */
  description: string;
  children: React.ReactNode;
  /** Hide the visible title but keep it for assistive tech. */
  hideTitle?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * ResponsiveSheet — one overlay component that adapts to form factor.
 *
 * Mobile  : bottom sheet, thumb-reachable, with a drag handle affordance.
 * ≥ sm    : right-hand side panel.
 *
 * Using a single component keeps overlay behaviour (focus trap, escape, scroll
 * lock) identical everywhere instead of drifting per screen.
 */
export function ResponsiveSheet({
  trigger,
  title,
  description,
  children,
  hideTitle = false,
  className,
  open,
  onOpenChange,
}: ResponsiveSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger render={<span />}>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        className={cn(
          "glass-strong max-h-[88dvh] rounded-t-glass-lg border-glass-border p-0",
          "sm:inset-y-0 sm:right-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none sm:rounded-l-glass-lg",
          className,
        )}
      >
        {/* Drag affordance — mobile only. */}
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-ink-muted/30" />
        </div>

        <SheetHeader className="gap-1 px-5 pt-3 pb-2 text-left">
          <SheetTitle className={cn("text-ink", hideTitle && "sr-only")}>
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
