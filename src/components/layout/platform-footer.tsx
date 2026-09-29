import Image from "next/image";

export function PlatformFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1400px] px-4 pb-[calc(92px+env(safe-area-inset-bottom))] sm:px-6 lg:pb-8">
      <div className="glass flex flex-col gap-4 rounded-2xl border border-white/70 px-5 py-4 text-sm text-ink-secondary shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="leading-relaxed">
          <p>
            Developed by:{" "}
            <a className="font-semibold text-brand hover:underline" href="https://agentsiraji.com" target="_blank" rel="noreferrer">
              AgentSiraji.com
            </a>
          </p>
          <p>Contact: <a className="hover:underline" href="mailto:business@agentsiraji.com">business@agentsiraji.com</a></p>
        </div>
        <div className="flex items-center gap-3" aria-label="Doctor's Diary">
          <Image src="/brand/dd-logo-mark-canonical.webp" alt="" width={40} height={40} aria-hidden="true" className="size-10 object-contain" />
          <div>
            <p className="font-semibold text-ink">Doctor&apos;s Diary</p>
            <p className="text-[11px] font-medium tracking-[0.18em] text-ink-secondary">CARE · RECORD · CONNECT</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
