"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark, BrandWordmark } from "@/components/brand/brand-mark";
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "./nav-config";

/**
 * DesktopSidebar — persistent on ≥ xl, an icon rail on lg/tablet.
 *
 * Glass is correct here: this is chrome, not clinical content. It is one of the
 * two blur layers the view is allowed.
 */
export function DesktopSidebar({
  counts,
}: {
  /** Live per-request counts, keyed by `NavItem.badgeKey`. */
  counts?: Partial<Record<NonNullable<NavItem["badgeKey"]>, number>>;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="dd-sidebar glass sticky top-3 hidden h-[calc(100dvh-1.5rem)] shrink-0 flex-col border-r border-glass-border lg:flex lg:w-[76px] xl:w-[248px]"
      aria-label="Main navigation"
    >
      <Link
        href="/dashboard"
        className="flex h-16 items-center gap-2.5 rounded-2xl px-4 focus-visible:focus-ring xl:px-5"
        aria-label="Doctor's Diary — Dashboard"
      >
        <BrandMark className="h-9 w-11" />
        <BrandWordmark className="hidden min-w-0 text-[15px] xl:block" tagline />
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-1">
          {PRIMARY_NAV.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              pathname={pathname}
              count={item.badgeKey ? counts?.[item.badgeKey] : undefined}
            />
          ))}
        </ul>
      </nav>

      <div className="border-t border-glass-border px-3 py-3">
        <Link
          href="/assistant"
          className="dd-assistant-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-brand transition-colors focus-visible:focus-ring xl:px-3"
        >
          <Sparkles className="size-[18px] shrink-0" aria-hidden="true" />
          <span className="hidden min-w-0 xl:block">
            <span className="block text-[13px] leading-tight font-semibold">
              AI Assistant
            </span>
            <span className="block truncate text-[11px] text-brand/70">
              Mock mode — no live AI
            </span>
          </span>
          <span className="sr-only xl:hidden">AI Assistant</span>
        </Link>

        <ul className="mt-1 space-y-1">
          {SECONDARY_NAV.map((item) => (
            <SidebarLink key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  pathname,
  count,
}: {
  item: NavItem;
  pathname: string;
  /** Undefined when there is nothing to count, or nothing to say. */
  count?: number;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        title={item.label}
        className={cn(
          "dd-nav-item group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:focus-ring",
          "lg:justify-center xl:justify-start",
          active
            ? "dd-nav-active text-brand shadow-soft"
            : "text-ink-secondary hover:bg-white/60 hover:text-ink",
        )}
      >
        <span className="shrink-0" aria-hidden="true">
          {item.icon}
        </span>
        <span className="hidden flex-1 truncate xl:block">{item.label}</span>
        {/*
          Shown only when there is something there. A "0" chip beside every
          item is visual noise on a quiet morning, and — more importantly — a
          zero that appeared when the read had actually failed would be a lie
          about an empty waiting room. `getNavCounts` returns no count rather
          than a zero in that case.
        */}
        {typeof count === "number" && count > 0 ? (
          <span
            className={cn(
              "hidden shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums xl:inline-block",
              active ? "bg-brand-soft text-brand" : "bg-surface-muted text-ink-muted",
            )}
          >
            {count}
          </span>
        ) : null}
        <span className="sr-only xl:hidden">{item.label}</span>
      </Link>
    </li>
  );
}
