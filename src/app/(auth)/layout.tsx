import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 sm:py-10">
      <Link
        href="/login"
        className="liquid-app-header mb-6 flex w-full max-w-[620px] items-center justify-between gap-4 rounded-[26px] px-4 py-3.5 focus-visible:focus-ring sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <BrandMark className="size-11 sm:size-12" />
          <span className="min-w-0">
            <span className="block truncate text-[20px] leading-tight font-semibold tracking-[-0.025em] text-[#40348f]">
              Doctor&apos;s Diary
            </span>
            <span className="mt-1 block truncate text-[10px] font-medium uppercase tracking-[0.18em] text-[#77708f]">
              Care · Record · Connect
            </span>
          </span>
        </span>

        <span className="liquid-secondary hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-medium text-[#625b79] sm:inline-flex">
          <ShieldCheck className="size-3.5 text-brand" aria-hidden="true" />
          Secure access
        </span>
      </Link>

      <main className="w-full max-w-[430px]">{children}</main>

      <p className="liquid-secondary mt-6 max-w-[470px] rounded-full px-4 py-2 text-center text-[11px] leading-relaxed text-ink-muted">
        Development build · Use fake data only · Not approved for real patient information
      </p>
    </div>
  );
}
