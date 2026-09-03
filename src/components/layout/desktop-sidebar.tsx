"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/brand-mark";
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "./nav-config";

export function DesktopSidebar({
  counts,
}: {
  counts?: Partial<Record<NonNullable<NavItem["badgeKey"]>, number>>;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="dd-sidebar sticky top-4 ml-4 my-4 hidden h-[calc(100dvh-2rem)] shrink-0 flex-col lg:flex lg:w-[82px] xl:w-[232px]"
      aria-label="Main navigation"
    >
      <Link
        href="/dashboard"
        className="mx-3 mt-3.5 flex h-[68px] items-center gap-3 rounded-[20px] px-2.5 focus-visible:focus-ring xl:px-3"
        aria-label="Doctor's Diary — Today"
      >
        <BrandMark className="size-11" />
        <span className="hidden min-w-0 xl:block">
          <span className="block truncate text-[17px] leading-tight font-semibold tracking-[-0.025em] text-[#40358f]">
            Doctor&apos;s Diary
          </span>
          <span className="mt-1 block truncate text-[10px] font-medium uppercase tracking-[0.18em] text-[#77708f]">
            Clinical workspace
          </span>
        </span>
      </Link>

      <div className="mx-4 mt-2 h-px bg-white/65" aria-hidden="true" />

      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-2">
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
        <div className="border-t border-white/60 px-3 py-3">
          <ul className="space-y-1.5">
            {SECONDARY_NAV.map((item) => (
              <SidebarLink key={item.href} item={item} pathname={pathname} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="px-3 pb-4">
        <div className="dd-sidebar-note hidden rounded-[18px] px-3 py-3 text-[11px] leading-relaxed text-ink-muted xl:block">
          <span className="block font-semibold text-[#4c4667]">Doctor-first workspace</span>
          Fast access to today, patients and appointments.
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
          "dd-nav-item flex min-h-12 items-center gap-3 rounded-[16px] px-3 py-2.5 text-[14px] font-medium focus-visible:focus-ring",
          "lg:justify-center xl:justify-start",
          active ? "dd-nav-active text-brand" : "text-ink-secondary hover:text-ink",
        )}
      >
        <span className="shrink-0" aria-hidden="true">{item.icon}</span>
        <span className="hidden flex-1 truncate xl:block">{item.label}</span>
        {typeof count === "number" && count > 0 ? (
          <span className="hidden shrink-0 rounded-full border border-white/70 bg-white/72 px-1.5 py-0.5 text-[11px] font-semibold text-brand shadow-[inset_0_1px_0_white] tabular-nums xl:inline-block">
            {count}
          </span>
        ) : null}
        <span className="sr-only xl:hidden">{item.label}</span>
      </Link>
    </li>
  );
}
