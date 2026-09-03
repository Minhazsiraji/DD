"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_NAV } from "./nav-config";

/** Doctor Pilot mobile navigation — Today · Patients · Appointments · More. */
export function MobileBottomNav() {
  const pathname = usePathname();

  if (pathname.startsWith("/consultation/")) return null;

  return (
    <nav
      aria-label="Primary"
      data-print-hidden
      className="glass-strong fixed inset-x-0 bottom-0 z-40 border-t border-glass-border pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 py-1">
        {MOBILE_NAV.map((item) => (
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
    <li className="min-w-0">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl border border-transparent px-1 py-1.5 transition-[background-color,border-color,color,box-shadow] focus-visible:focus-ring",
          active
            ? "dd-nav-active text-brand"
            : "text-ink-muted hover:bg-white/45 hover:text-ink-secondary",
        )}
      >
        <span aria-hidden="true">{icon}</span>
        <span className="w-full truncate text-center text-[12px] leading-none font-medium">{label}</span>
      </Link>
    </li>
  );
}
