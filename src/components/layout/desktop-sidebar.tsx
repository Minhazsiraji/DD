"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/brand-mark";
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "./nav-config";

/**
 * DesktopSidebar — the selected Doctor's Diary liquid-glass chrome.
 * Clinical work remains solid; only the navigation shell gets translucent depth.
 */
export function DesktopSidebar({
  counts,
}: {
  counts?: Partial<Record<NonNullable<NavItem["badgeKey"]>, number>>;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="glass sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-glass-border lg:flex lg:w-[72px] xl:w-[224px]"
      aria-label="Main navigation"
    >
      <Link
        href="/dashboard"
        className="mx-3 mt-3 flex h-[60px] items-center gap-3 rounded-2xl px-2.5 focus-visible:focus-ring xl:px-3"
        aria-label="Doctor's Diary — Today"
      >
        <BrandMark className="size-10" />
        <span className="hidden min-w-0 xl:block">
          <span className="block truncate text-[16px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            Doctor&apos;s Diary
          </span>
          <span className="mt-0.5 block truncate text-[11px] tracking-[0.01em] text-ink-muted">
            Care. Record. Connect.
          </span>
        </span>
      </Link>

      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-1.5">
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

      {SECONDARY_NAV.length > 0 ? (
        <div className="border-t border-glass-border px-3 py-3">
          <ul className="space-y-1">
            {SECONDARY_NAV.map((item) => (
              <SidebarLink key={item.href} item={item} pathname={pathname} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="px-3 pb-4">
        <div className="hidden rounded-2xl border border-brand/10 bg-white/58 px-3 py-3 text-[11px] leading-relaxed text-ink-muted xl:block">
          <span className="block font-semibold text-ink-secondary">Clinical workspace</span>
          Fast, calm and focused on the next patient.
        </div>
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
          "group flex min-h-11 items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-[14px] font-medium transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:focus-ring",
          "lg:justify-center xl:justify-start",
          active
            ? "dd-nav-selected text-brand"
            : "text-ink-secondary hover:border-brand/8 hover:bg-white/70 hover:text-ink",
        )}
      >
        <span className="shrink-0" aria-hidden="true">
          {item.icon}
        </span>
        <span className="hidden flex-1 truncate xl:block">{item.label}</span>
        {typeof count === "number" && count > 0 ? (
          <span
            className={cn(
              "hidden shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums xl:inline-block",
              active ? "bg-white/75 text-brand" : "bg-surface-muted text-ink-muted",
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
