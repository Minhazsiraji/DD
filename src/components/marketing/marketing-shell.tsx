import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";

const nav = [
  ["Features", "/features"],
  ["How it works", "/how-it-works"],
  ["Pricing", "/pricing"],
  ["Security", "/security"],
  ["FAQ", "/faq"],
] as const;

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen text-ink">
      <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6 lg:px-8">
        <div className="dd-public-header mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-5">
          <Link href="/" className="flex min-w-0 items-center gap-3 rounded-2xl focus-visible:focus-ring">
            <BrandMark className="size-10 sm:size-11" />
            <span className="min-w-0">
              <span className="block truncate text-[17px] leading-none font-semibold tracking-[-0.025em] text-[#40358f] sm:text-[18px]">
                Doctor&apos;s Diary
              </span>
              <span className="mt-1 block truncate text-[10px] font-medium uppercase tracking-[0.16em] text-ink-muted">
                Care · Record · Connect
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1.5 text-[13px] text-ink-secondary lg:flex" aria-label="Main navigation">
            {nav.map(([label, href]) => (
              <Link key={href} href={href} className="rounded-full px-3 py-2 font-medium transition hover:bg-white/48 hover:text-ink focus-visible:focus-ring">
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/login" className="dd-secondary hidden h-10 items-center rounded-full px-4 text-[13px] font-semibold text-ink-secondary sm:inline-flex">
              Sign in
            </Link>
            <Link href="/signup" className="dd-primary inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold text-white sm:h-11 sm:px-5">
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="px-4 pb-5 pt-10 sm:px-6 lg:px-8">
        <div className="dd-public-footer mx-auto grid max-w-7xl gap-8 px-5 py-7 text-[13px] text-ink-secondary md:grid-cols-[1.6fr_1fr_1fr] sm:px-7">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark className="size-9" />
              <p className="font-semibold text-[#40358f]">Doctor&apos;s Diary</p>
            </div>
            <p className="mt-3 max-w-md leading-6">Less typing. Less searching. Less remembering. More patient.</p>
          </div>
          <div className="grid gap-2">
            <Link href="/features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/security">Security</Link>
          </div>
          <div className="grid gap-2">
            <Link href="/faq">FAQ</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/login">Doctor sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function MarketingPage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-5 pb-20 pt-16 lg:px-8 lg:pt-20">
        <div className="max-w-3xl">
          <p className="dd-chip inline-flex rounded-full px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6655cf]">{eyebrow}</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.035em] text-[#262147] sm:text-5xl">{title}</h1>
          <p className="mt-5 text-[17px] leading-8 text-ink-secondary">{intro}</p>
        </div>
        <div className="mt-12">{children}</div>
      </section>
    </MarketingShell>
  );
}
