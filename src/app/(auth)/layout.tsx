import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link
        href="/login"
        className="mb-6 flex items-center gap-3 rounded-2xl focus-visible:focus-ring"
      >
        <BrandMark className="size-12" />
        <span>
          <span className="block text-[20px] leading-tight font-semibold tracking-[-0.025em] text-[#40348f]">
            Doctor&apos;s Diary
          </span>
          <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.18em] text-ink-muted">
            Care · Record · Connect
          </span>
        </span>
      </Link>

      <main className="w-full max-w-[430px]">{children}</main>

      <p className="mt-6 max-w-[430px] text-center text-xs leading-relaxed text-ink-muted">
        Development build. Use fake data only — this project is not approved for real patient information.
      </p>
    </div>
  );
}
