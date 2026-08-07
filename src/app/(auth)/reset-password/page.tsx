import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/components/password-forms";

export const metadata: Metadata = { title: "New password" };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
