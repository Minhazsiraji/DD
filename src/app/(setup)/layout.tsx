import Link from "next/link";
import { Stethoscope } from "lucide-react";
import { IconOrb } from "@/components/common/icon-orb";
import { signOutAction } from "@/features/auth/actions";

/**
 * Shell for first-run setup. Signed in, but not yet a member of any clinic —
 * so no sidebar, no navigation, nothing that assumes a clinic context exists.
 */
export default function SetupLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[640px]">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/onboarding"
            className="flex items-center gap-2.5 rounded-xl focus-visible:focus-ring"
          >
            <IconOrb accent="brand" size="md">
              <Stethoscope className="size-[18px]" />
            </IconOrb>
            <span className="text-[15px] leading-tight font-semibold text-ink">
              Doctor&apos;s Diary
            </span>
          </Link>

          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-white/70 hover:text-ink focus-visible:focus-ring"
            >
              Sign out
            </button>
          </form>
        </div>

        {children}
      </div>
    </div>
  );
}
