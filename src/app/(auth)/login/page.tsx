import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link_expired: "That link has expired. Request a new one.",
  missing_code: "That link was incomplete. Try again.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  // searchParams is async in Next.js 16.
  const params = await props.searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const errorKey = typeof params.error === "string" ? params.error : undefined;

  return (
    <>
      {errorKey && ERRORS[errorKey] ? (
        <p
          role="status"
          className="mb-4 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] font-medium text-[#8a3f07]"
        >
          {ERRORS[errorKey]}
        </p>
      ) : null}
      <LoginForm next={next} />
    </>
  );
}
