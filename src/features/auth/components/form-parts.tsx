"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, Eye, EyeOff, Loader } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionState } from "../schema";

/**
 * Shared auth form parts.
 *
 * Errors are wired with aria-describedby and aria-invalid rather than colour
 * alone, and the submit button reflects pending state so a slow network cannot
 * produce a double submission.
 */

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

  /**
   * Show/hide, on every password box.
   *
   * A doctor signing in on a phone at a chamber desk types a password they
   * cannot see, gets it wrong, and cannot tell whether the problem is the
   * password or the account — which is exactly the moment someone starts
   * requesting reset links. The control is plain, off by default, and reverts
   * to hidden on every render of a fresh form.
   *
   * `type` is swapped rather than a second input rendered, so there is only
   * ever ONE field with this name: a hidden duplicate is how a browser autofill
   * ends up submitting the wrong value.
   */
  const isPassword = type === "password";
  const [revealed, setRevealed] = React.useState(false);
  const shown = isPassword && revealed;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={shown ? "text" : type}
          required={required}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          aria-invalid={hasError || undefined}
          aria-describedby={
            [hasError ? errorId : null, hint ? hintId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className={cn(
            "h-11 w-full rounded-xl border bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring",
            // Room for the toggle, so a long password never runs under it.
            isPassword && "pr-11",
            hasError ? "border-danger" : "border-hairline",
          )}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-pressed={revealed}
            aria-controls={id}
            aria-label={revealed ? "Hide password" : "Show password"}
            /*
              `tabIndex={-1}`: keyboard users tab from the password straight to
              the submit button, which is the whole point of the form. The
              control stays reachable by pointer and by screen reader.
            */
            tabIndex={-1}
            className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted transition-colors hover:text-ink focus-visible:focus-ring"
          >
            {revealed ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p
          id={errorId}
          className="flex items-start gap-1.5 text-xs font-medium text-danger"
        >
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
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:focus-ring motion-reduce:active:scale-100"
    >
      {pending ? (
        <>
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          Working…
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Form-level message. `role=status` so screen readers announce it. */
export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;

  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium",
        state.ok
          ? "bg-success-soft text-[#07684a]"
          : "bg-danger-soft text-[#a81c1c]",
      )}
    >
      {state.ok ? (
        <CircleCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
      ) : (
        <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
      )}
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
    <div className="clinical-surface rounded-glass-lg p-6 shadow-raised sm:p-7">
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      {subtitle ? (
        <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>
      ) : null}
      <div className="mt-5">{children}</div>
      {footer ? (
        <div className="mt-5 border-t border-hairline pt-4 text-center text-[13px] text-ink-secondary">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
