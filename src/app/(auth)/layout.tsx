import { PublicGlassHeader } from "@/components/marketing/marketing-shell";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="dd-auth-page min-h-dvh text-ink">
      <PublicGlassHeader />

      <div className="dd-auth-shell flex min-h-[calc(100dvh-88px)] flex-col items-center justify-center px-4 pb-6 pt-8 sm:pb-8 sm:pt-10">
        <main className="w-full max-w-[430px]">{children}</main>

        <p className="dd-auth-disclaimer mt-5 max-w-[470px] rounded-full px-4 py-2 text-center text-[10.5px] leading-relaxed">
          Development build · Use fake data only · Not approved for real patient information
        </p>
      </div>
    </div>
  );
}
