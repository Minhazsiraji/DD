"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { signInAction } from "../actions";
import { emptyState } from "../schema";
import { AuthCard, Field, FormMessage, SubmitButton } from "./form-parts";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signInAction, emptyState);

  return (
    <AuthCard
      title="Sign in"
      subtitle="Continue to your clinical workspace."
      footer={
        <>
          New here?{" "}
          <Link
            href="/signup"
            className="font-semibold text-brand hover:underline focus-visible:focus-ring rounded"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          errors={state.fieldErrors?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          errors={state.fieldErrors?.password}
        />

        <div className="text-right">
          <Link
            href="/forgot-password"
            className="rounded text-[13px] font-medium text-brand hover:underline focus-visible:focus-ring"
          >
            Forgot password?
          </Link>
        </div>

        <FormMessage state={state} />
        <SubmitButton>Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
