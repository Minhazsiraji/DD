"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { signUpAction } from "../actions";
import { emptyState } from "../schema";
import { AuthCard, Field, FormMessage, SubmitButton } from "./form-parts";

export function SignupForm() {
  const [state, formAction] = useActionState(signUpAction, emptyState);

  return (
    <AuthCard
      title="Create your account"
      subtitle="You'll set up your chamber in the next step."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-brand hover:underline focus-visible:focus-ring rounded"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4" noValidate>
        <Field
          label="Full name"
          name="fullName"
          autoComplete="name"
          errors={state.fieldErrors?.fullName}
        />
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
          autoComplete="new-password"
          hint="At least 10 characters. Length matters more than symbols."
          errors={state.fieldErrors?.password}
        />

        <FormMessage state={state} />
        <SubmitButton>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
