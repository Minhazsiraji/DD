"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV } from "./nav-config";
import { cn } from "@/lib/utils";

/** Desktop pilot navigation, styled to match the approved liquid-glass board. */
export function DesktopTopNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="hidden min-w-0 items-center gap-1 lg:flex">
      {PRIMARY_NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "liquid-nav-pill inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-all duration-150 focus-visible:focus-ring",
              active ? "liquid-nav-pill-active text-brand" : "text-ink-secondary hover:text-ink",
            )}
          >
            <span className="shrink-0" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
