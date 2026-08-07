import Link from "next/link";
import { Stethoscope } from "lucide-react";
import { IconOrb } from "@/components/common/icon-orb";

/**
 * Shell for the signed-out routes. Deliberately minimal — no navigation, no
 * data, nothing that could render before a session exists.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link
        href="/login"
        className="mb-6 flex items-center gap-2.5 rounded-xl focus-visible:focus-ring"
      >
        <IconOrb accent="brand" size="lg">
          <Stethoscope className="size-5" />
        </IconOrb>
        <span>
          <span className="block text-lg leading-tight font-semibold text-ink">
            Doctor&apos;s Diary
          </span>
          <span className="block text-xs text-ink-muted">Clinical workspace</span>
        </span>
      </Link>

      <main className="w-full max-w-[420px]">{children}</main>

      <p className="mt-6 max-w-[420px] text-center text-xs text-ink-muted">
        Development build. Use fake data only — this project is not approved for
        real patient information.
      </p>
    </div>
  );
}
