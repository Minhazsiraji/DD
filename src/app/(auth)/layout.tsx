import Link from "next/link";
import { BrandMark, BrandWordmark } from "@/components/brand/brand-mark";

/**
 * Shell for the signed-out routes. Deliberately minimal — no navigation, no
 * data, nothing that could render before a session exists.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="dd-auth-shell flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link
        href="/login"
        className="mb-6 flex items-center gap-2.5 rounded-xl focus-visible:focus-ring"
      >
        <BrandMark className="h-10 w-12" />
        <BrandWordmark className="text-[17px]" tagline />
      </Link>

      <main className="w-full max-w-[420px]">{children}</main>

      <p className="mt-6 max-w-[420px] text-center text-xs text-ink-muted">
        Development build. Use fake data only — this project is not approved for
        real patient information.
      </p>
    </div>
  );
}
