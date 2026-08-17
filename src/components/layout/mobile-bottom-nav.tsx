"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_NAV } from "./nav-config";
import { QuickActionMenu } from "./quick-action-menu";

/**
 * MobileBottomNav — Home · Patients · (+) · Appointments · More
 *
 * Fixed, glass, and safe-area aware. Hidden from lg upward where the sidebar
 * takes over.
 *
 * Hidden during a consultation: the save bar owns the bottom of the screen
 * there, and two stacked bars on a phone leave almost nothing for the notes.
 * Navigating away mid-consultation should also be a deliberate act, not a
 * thumb landing on Home while reaching for Save.
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const [left, right] = [MOBILE_NAV.slice(0, 2), MOBILE_NAV.slice(2)];

  if (pathname.startsWith("/consultation/")) return null;

  return (
    <nav
      aria-label="Primary"
      data-print-hidden
      className="glass-strong fixed inset-x-0 bottom-0 z-40 border-t border-glass-border pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2">
        {left.map((item) => (
          <NavTab key={item.href} {...item} pathname={pathname} />
        ))}

        <li className="flex shrink-0 items-start justify-center px-1">
          <QuickActionMenu variant="fab" />
        </li>

        {right.map((item) => (
          <NavTab key={item.href} {...item} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
}

function NavTab({
  href,
  label,
  icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  pathname: string;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <li className="min-w-0 flex-1">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-colors focus-visible:focus-ring",
          active ? "text-brand" : "text-ink-muted",
        )}
      >
        <span aria-hidden="true">{icon}</span>
        <span className="w-full truncate text-center text-[11px] leading-none font-medium">
          {label}
        </span>
      </Link>
    </li>
  );
}
