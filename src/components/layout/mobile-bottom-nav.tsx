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
      className="glass-strong fixed inset-x-2.5 bottom-2.5 z-40 rounded-[20px] border border-glass-border pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-1.5 py-1.5">
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
          "flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-[14px] border border-transparent px-1 py-1.5 focus-visible:focus-ring",
          active ? "dd-nav-active text-brand" : "text-ink-muted hover:bg-white/45 hover:text-ink-secondary",
        )}
      >
        <span aria-hidden="true" className="[&>svg]:size-[18px]">{icon}</span>
        <span className="w-full truncate text-center text-[10.5px] leading-none font-medium">{label}</span>
      </Link>
    </li>
  );
}
