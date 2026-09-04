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
      <span className="dd-public-stage-light" aria-hidden />

      <header className="sticky top-0 z-40 px-2.5 pt-2.5 sm:px-4 sm:pt-3 lg:px-6">
        <div className="dd-public-header dd-layered-slab mx-auto max-w-7xl">
          <span className="dd-glass-light" aria-hidden />
          <span className="dd-glass-glows" aria-hidden />
          <span className="dd-glass-contour" aria-hidden />

          <div className="dd-public-header-content flex min-h-[56px] items-center justify-between gap-2.5 px-3 py-2 sm:min-h-[60px] sm:px-4">
            <Link
              href="/"
              className="flex min-w-0 items-center gap-2.5 rounded-2xl focus-visible:focus-ring"
            >
              <BrandMark className="h-9 w-12 shrink-0 sm:h-10 sm:w-[54px]" />
              <BrandWordmark className="text-[15.5px] sm:text-[17px]" tagline />
            </Link>

            <nav
              className="hidden items-center gap-1 text-[12px] text-ink-secondary lg:flex"
              aria-label="Main navigation"
            >
              {nav.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-full px-3 py-2 font-medium transition hover:bg-white/48 hover:text-ink focus-visible:focus-ring"
                >
                  {label}
                </Link>
              ))}
            </nav>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Link
                href="/login"
                className="dd-secondary hidden h-9 items-center rounded-full px-3.5 text-[12px] font-semibold text-ink-secondary sm:inline-flex"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="dd-primary inline-flex h-9 items-center whitespace-nowrap rounded-full px-3.5 text-[12px] font-semibold text-white sm:h-10 sm:px-4 sm:text-[12.5px]"
              >
                Start free
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="px-3 pb-4 pt-8 sm:px-5 lg:px-7">
        <div className="dd-public-footer mx-auto grid max-w-7xl gap-6 px-4 py-5 text-[12.5px] text-ink-secondary sm:px-6 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark className="h-8 w-11" />
              <BrandWordmark className="text-[14px]" />
            </div>
            <p className="mt-2.5 max-w-md leading-5">
              Less typing. Less searching. Less remembering. More patient.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Link href="/features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/security">Security</Link>
          </div>
          <div className="grid gap-1.5">
            <Link href="/faq">FAQ</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/login">Doctor sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function MarketingPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-4 pb-14 pt-9 sm:px-5 sm:pt-12 lg:px-7 lg:pt-14">
        <div className="max-w-3xl">
          <p className="dd-chip inline-flex rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-[38px] leading-[1.02] font-semibold tracking-[-0.04em] text-[#262147] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 text-[16px] leading-7 text-ink-secondary sm:text-[17px] sm:leading-8">
            {intro}
          </p>
        </div>
        <div className="mt-9 sm:mt-11">{children}</div>
      </section>
    </MarketingShell>
  );
}
