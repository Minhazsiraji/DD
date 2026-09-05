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
            className="rounded font-semibold text-brand hover:underline focus-visible:focus-ring"
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

        <label className="liquid-secondary flex items-start gap-2.5 rounded-[18px] px-3.5 py-3 text-[13px] text-ink">
          <input
            type="checkbox"
            name="sharedDevice"
            className="mt-0.5 size-4 shrink-0 rounded border-hairline text-brand focus-visible:focus-ring"
          />
          <span>
            This is a shared or public computer
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
              Locks after 10 minutes idle, and is forgotten when the browser closes.
            </span>
          </span>
        </label>

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
