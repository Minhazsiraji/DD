"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction, resetPasswordAction } from "../actions";
import { emptyState } from "../schema";
import { AuthCard, Field, FormMessage, SubmitButton } from "./form-parts";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, emptyState);

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <Link
          href="/login"
          className="rounded font-semibold text-brand hover:underline focus-visible:focus-ring"
        >
          Back to sign in
        </Link>
      }
    >
      <form action={formAction} className="space-y-4" noValidate>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          errors={state.fieldErrors?.email}
        />
        <FormMessage state={state} />
        <SubmitButton>Send reset link</SubmitButton>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPasswordAction, emptyState);

  return (
    <AuthCard title="Set a new password">
      <form action={formAction} className="space-y-4" noValidate>
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
          errors={state.fieldErrors?.password}
        />
        <Field
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          errors={state.fieldErrors?.confirmPassword}
        />
        <FormMessage state={state} />
        <SubmitButton>Update password</SubmitButton>
      </form>
    </AuthCard>
  );
}
