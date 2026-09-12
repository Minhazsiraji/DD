"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { DASHBOARD_TABS, tabHref } from "../catalog";

/**
 * The seven dashboard sections.
 *
 * A horizontal strip that scrolls with snap on a phone and sits in one row on
 * a desktop. Moving between tabs keeps the owner's period — `?period=7d` — so
 * switching from Overview to Costs does not silently reset the range.
 *
 * Plain links, not a Base UI Tabs widget: each tab is a real route with its own
 * server-rendered data, and a link is the thing that is actually happening.
 */
export function DashboardTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const query = params.toString();

  return (
    <nav aria-label="Dashboard sections" className="min-w-0">
      <ul
        data-mobile-dashboard-tabs
        className="dd-material-panel flex w-full min-w-0 snap-x snap-mandatory gap-1 overflow-x-auto rounded-glass p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {DASHBOARD_TABS.map((tab) => {
          const href = tabHref(tab.slug);
          const active = pathname === href;
          return (
            <li key={tab.slug || "overview"} className="shrink-0 snap-start">
              <Link
                href={query ? `${href}?${query}` : href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 44px tall — a thumb target, per the design system.
                  "inline-flex h-11 items-center rounded-xl px-3.5 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:focus-ring",
                  active
                    ? "dd-material-record dd-record-pearl text-ink"
                    : "text-ink-secondary hover:bg-white/30 hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
