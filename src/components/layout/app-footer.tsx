"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const excluded = (path: string) =>
  path === "/dashboard" || path.startsWith("/consultation/") || path.startsWith("/prescription/");

export function AppFooter() {
  const pathname = usePathname();
  if (excluded(pathname)) return null;

  return (
    <footer className="mx-auto w-full max-w-[1400px] px-4 pb-[calc(92px+env(safe-area-inset-bottom))] pt-6 sm:px-6 lg:pb-8">
      <div className="border-t border-white/70 pt-4 text-xs text-ink-secondary">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><span>Developed by: </span><a className="font-semibold text-brand hover:underline" href="https://agentsiraji.com" target="_blank" rel="noreferrer">AgentSiraji.com</a><span className="mx-2">·</span><a className="hover:underline" href="mailto:business@agentsiraji.com">business@agentsiraji.com</a></div>
          <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legal and help">
            <Link href="/privacy" className="hover:text-ink hover:underline">Privacy</Link><Link href="/terms" className="hover:text-ink hover:underline">Terms &amp; Conditions</Link><Link href="/faq" className="hover:text-ink hover:underline">Frequently Asked Questions</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
