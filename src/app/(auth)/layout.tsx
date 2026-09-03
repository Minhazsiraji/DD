import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-6 sm:py-8">
      <Link
        href="/login"
        className="dd-public-header mb-5 flex w-full max-w-[560px] items-center justify-between gap-3 px-3.5 py-2.5 focus-visible:focus-ring sm:px-4"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <BrandMark className="size-9 sm:size-10" />
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-[17px] leading-tight font-semibold tracking-[-0.025em] text-[#40358f] sm:text-[18px]">
              Doctor&apos;s Diary
            </span>
            <span className="mt-0.5 hidden whitespace-nowrap text-[8.5px] font-medium uppercase tracking-[0.18em] text-ink-muted sm:block">
              Care · Record · Connect
            </span>
          </span>
        </span>

        <span className="dd-secondary hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-medium text-ink-secondary sm:inline-flex">
          <ShieldCheck className="size-3.5 text-brand" aria-hidden="true" />
          Secure access
        </span>
      </Link>

      <main className="w-full max-w-[410px]">{children}</main>

      <p className="dd-secondary mt-5 max-w-[450px] rounded-full px-4 py-2 text-center text-[10.5px] leading-relaxed text-ink-muted">
        Development build · Use fake data only · Not approved for real patient information
      </p>
    </div>
  );
}
