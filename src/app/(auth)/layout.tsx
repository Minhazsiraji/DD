import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { BrandMark, BrandWordmark } from "@/components/brand/brand-mark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="dd-auth-shell flex min-h-dvh flex-col items-center justify-center px-4 py-6 sm:py-8">
      <div className="dd-approved-stage dd-auth-header-stage mb-5 w-full max-w-[560px]">
        <span className="dd-approved-light" aria-hidden />
        <Link
          href="/"
          className="dd-public-header dd-approved-slab block w-full focus-visible:focus-ring"
        >
          <span className="dd-approved-glows" aria-hidden />
          <span className="dd-approved-contour" aria-hidden />
          <span className="dd-approved-content flex items-center justify-between gap-3 px-3.5 py-2.5 sm:px-4">
            <span className="flex min-w-0 items-center gap-2.5">
              <BrandMark className="h-10 w-[54px] sm:h-11 sm:w-[60px]" />
              <BrandWordmark className="text-[17px] sm:text-[18px]" tagline />
            </span>

            <span className="dd-secondary hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-semibold sm:inline-flex">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Secure access
            </span>
          </span>
        </Link>
      </div>

      <main className="w-full max-w-[430px]">{children}</main>

      <p className="dd-auth-disclaimer mt-5 max-w-[470px] rounded-full px-4 py-2 text-center text-[10.5px] leading-relaxed">
        Development build · Use fake data only · Not approved for real patient information
      </p>
    </div>
  );
}
