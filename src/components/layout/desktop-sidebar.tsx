"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandMark, BrandWordmark } from "@/components/brand/brand-mark";
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "./nav-config";

export function DesktopSidebar({
  counts,
}: {
  counts?: Partial<Record<NonNullable<NavItem["badgeKey"]>, number>>;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="dd-sidebar sticky top-3 hidden h-[calc(100dvh-1.5rem)] shrink-0 flex-col lg:flex lg:w-[74px] xl:w-[220px]"
      aria-label="Main navigation"
    >
      <Link
        href="/dashboard"
        className="mx-2.5 mt-2.5 flex h-[60px] items-center gap-2 rounded-[18px] px-2 focus-visible:focus-ring xl:px-2.5"
        aria-label="Doctor's Diary — Today"
      >
        <BrandMark className="h-9 w-11 shrink-0" />
        <BrandWordmark className="hidden min-w-0 text-[15.5px] xl:block" tagline />
      </Link>

      <div className="mx-3.5 mt-1 h-px bg-white/65" aria-hidden="true" />

      <nav className="mt-3 flex-1 overflow-y-auto px-2.5 pb-3">
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
        <div className="border-t border-white/60 px-2.5 py-2.5">
          <ul className="space-y-1.5">
            {SECONDARY_NAV.map((item) => (
              <SidebarLink key={item.href} item={item} pathname={pathname} />
            ))}
          </ul>
        </div>
      ) : null}
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
          "dd-nav-item flex min-h-11 items-center gap-2.5 rounded-[15px] px-3 py-2 text-[13px] font-medium focus-visible:focus-ring",
          "lg:justify-center xl:justify-start",
          active ? "dd-nav-active text-brand" : "text-ink-secondary hover:text-ink",
        )}
      >
        <span className="shrink-0" aria-hidden="true">{item.icon}</span>
        <span className="hidden flex-1 truncate xl:block">{item.label}</span>
        {typeof count === "number" && count > 0 ? (
          <span className="hidden shrink-0 rounded-full border border-white/70 bg-white/72 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand shadow-[inset_0_1px_0_white] tabular-nums xl:inline-block">
            {count}
          </span>
        ) : null}
        <span className="sr-only xl:hidden">{item.label}</span>
      </Link>
    </li>
  );
}
