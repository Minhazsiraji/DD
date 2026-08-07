"use client";

import * as React from "react";
import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import { challengeAction } from "../actions";
import { emptyState } from "@/features/auth/schema";
import { AuthCard, Field, FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { signOutScopedAction } from "../actions";

export function ChallengeForm() {
  const [state, formAction] = useActionState(challengeAction, emptyState);

  return (
    <AuthCard
      title="Two-step verification"
      subtitle="Enter the 6-digit code from your authenticator app."
      footer={
        <form action={signOutScopedAction}>
          <input type="hidden" name="scope" value="local" />
          <button
            type="submit"
            className="rounded font-semibold text-brand hover:underline focus-visible:focus-ring"
          >
            Sign in as someone else
          </button>
        </form>
      }
    >
      <form action={formAction} className="space-y-4" noValidate>
        <Field
          label="6-digit code"
          name="code"
          type="text"
          autoComplete="one-time-code"
          errors={state.fieldErrors?.code}
        />
        <FormMessage state={state} />
        <SubmitButton>
          <ShieldCheck className="size-4" aria-hidden="true" />
          Verify
        </SubmitButton>
      </form>

      <p className="mt-4 text-xs text-ink-muted">
        Lost your phone? Use your backup authenticator. If you don&apos;t have
        one, you&apos;ll need to recover the account through support — there are
        no recovery codes.
      </p>
    </AuthCard>
  );
}
