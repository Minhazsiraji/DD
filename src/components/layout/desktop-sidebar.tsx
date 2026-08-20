"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Stethoscope, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconOrb } from "@/components/common/icon-orb";
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
      className="glass sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-glass-border lg:flex lg:w-[76px] xl:w-[248px]"
      aria-label="Main navigation"
    >
      <div className="flex h-16 items-center gap-2.5 px-4 xl:px-5">
        <IconOrb accent="brand" size="md">
          <Stethoscope className="size-[18px]" />
        </IconOrb>
        <span className="hidden min-w-0 xl:block">
          <span className="block truncate text-[15px] leading-tight font-semibold text-ink">
            Doctor&apos;s Diary
          </span>
          <span className="block truncate text-[11px] text-ink-muted">
            Clinical workspace
          </span>
        </span>
      </div>

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
          className="flex items-center gap-3 rounded-xl bg-brand-soft px-3 py-2.5 text-brand transition-colors hover:bg-[#d8e5fd] focus-visible:focus-ring xl:px-3"
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
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:focus-ring",
          "lg:justify-center xl:justify-start",
          active
            ? "bg-white text-brand shadow-soft"
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
