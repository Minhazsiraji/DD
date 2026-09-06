import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark, BrandWordmark } from "@/components/brand/brand-mark";

const nav = [
  ["Features", "/features"],
  ["How it works", "/how-it-works"],
  ["Pricing", "/pricing"],
  ["Security", "/security"],
  ["FAQ", "/faq"],
] as const;

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="dd-public-stage min-h-screen text-ink">
      <header className="dd-material-chrome sticky top-0 z-40 rounded-b-[28px] border-b border-white/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight">
            <BrandMark className="h-9 w-11" />
            <BrandWordmark className="text-[15px]" tagline />
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-ink-secondary lg:flex" aria-label="Main navigation">
            {nav.map(([label, href]) => (
              <Link key={href} href={href} className="rounded-lg transition hover:text-ink focus-visible:focus-ring">{label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden h-11 items-center rounded-xl px-4 text-sm font-medium text-ink-secondary hover:bg-white/40 focus-visible:focus-ring sm:inline-flex">Sign in</Link>
            <Link href="/signup" className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-hover focus-visible:focus-ring">Start free</Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="dd-material-panel mt-8 rounded-t-[32px] border-t border-white/80">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 text-sm text-ink-secondary md:grid-cols-[1.5fr_1fr_1fr] lg:px-8">
          <div>
            <p className="font-semibold text-ink">Doctor&apos;s Diary</p>
            <p className="mt-2 max-w-md">Less typing. Less searching. Less remembering. More patient.</p>
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
      <section className="mx-auto max-w-7xl px-5 pb-20 pt-16 lg:px-8 lg:pt-24">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">{eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{title}</h1>
          <p className="mt-5 text-lg leading-8 text-ink-secondary">{intro}</p>
        </div>
        <div className="mt-12">{children}</div>
      </section>
    </MarketingShell>
  );
}
