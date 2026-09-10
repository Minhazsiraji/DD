import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  ["Features", "/features"],
  ["How it works", "/how-it-works"],
  ["Pricing", "/pricing"],
  ["Security", "/security"],
  ["FAQ", "/faq"],
] as const;

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f9ff] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="grid size-10 place-items-center rounded-2xl bg-teal-600 text-lg text-white shadow-sm">✚</span>
            <span>
              <span className="block text-base leading-none">Doctor&apos;s Diary</span>
              <span className="mt-1 block text-xs font-normal text-slate-500">Doctor Productivity OS</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-600 lg:flex" aria-label="Main navigation">
            {nav.map(([label, href]) => (
              <Link key={href} href={href} className="transition hover:text-slate-950">{label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 sm:inline-flex">Sign in</Link>
            <Link href="/signup" className="inline-flex rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700">Start free</Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 text-sm text-slate-600 md:grid-cols-[1.5fr_1fr_1fr] lg:px-8">
          <div>
            <p className="font-semibold text-slate-950">Doctor&apos;s Diary</p>
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
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">{eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{title}</h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">{intro}</p>
        </div>
        <div className="mt-12">{children}</div>
      </section>
    </MarketingShell>
  );
}
