"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, Loader } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionState } from "../schema";

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
  defaultValue,
  hint,
  errors,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
  errors?: string[];
}) {
  const id = `field-${name}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12.5px] font-medium text-ink">{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={hasError || undefined}
        aria-describedby={[hasError ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined}
        className={cn(
          "dd-input dd-auth-input h-11 w-full rounded-full px-4 text-[13px] text-ink placeholder:text-ink-muted focus-visible:focus-ring",
          hasError ? "border-danger" : "",
        )}
      />
      {hint ? <p id={hintId} className="text-[11.5px] text-ink-muted">{hint}</p> : null}
      {hasError ? (
        <p id={errorId} className="flex items-start gap-1.5 text-[11.5px] font-medium text-danger">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {errors![0]}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="dd-primary inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 focus-visible:focus-ring"
    >
      {pending ? (
        <>
          <Loader className="size-3.5 animate-spin" aria-hidden="true" />
          Working…
        </>
      ) : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;

  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-[14px] px-3 py-2.5 text-[12px] font-medium",
        state.ok ? "bg-success-soft text-[#07684a]" : "bg-danger-soft text-[#a81c1c]",
      )}
    >
      {state.ok ? <CircleCheck className="mt-px size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />}
      {state.message}
    </p>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="dd-approved-stage dd-auth-card-stage">
      <span className="dd-approved-light" aria-hidden />
      <div className="dd-auth-card dd-approved-slab p-5 sm:p-6">
        <span className="dd-approved-glows" aria-hidden />
        <span className="dd-approved-contour" aria-hidden />
        <div className="dd-approved-content">
          <h1 className="text-[20px] font-semibold tracking-[-0.025em] text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 text-[13px] text-ink-secondary">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
          {footer ? (
            <div className="mt-5 border-t border-white/65 pt-4 text-center text-[12px] text-ink-secondary">{footer}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
