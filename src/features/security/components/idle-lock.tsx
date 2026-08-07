"use client";

import * as React from "react";
import { Lock, ShieldCheck, Loader, CircleAlert } from "lucide-react";
import { unlockAction, signOutScopedAction } from "../actions";
import { emptyState } from "@/features/auth/schema";
import { Field } from "@/features/auth/components/form-parts";
import { IconOrb } from "@/components/common/icon-orb";
import { shouldLock, shouldWarn, msUntilLock, idleLimitMs } from "../policy";

/**
 * Application-level idle lock.
 *
 * Built at app level on purpose: Supabase's inactivity-based session timeout is
 * a Pro feature and we are on Free, so relying on it would mean shipping no
 * protection at all.
 *
 * The threat this addresses is mundane and real — a doctor called away
 * mid-consultation leaving a patient's record on a clinic screen.
 *
 * The lock is an OVERLAY, not a navigation. Navigating away would discard
 * whatever the doctor had typed; covering the screen protects the content while
 * preserving in-progress work, which returns intact after unlocking.
 *
 * This is a privacy control, not an authorization boundary — the session is
 * still valid underneath, and every server action re-checks authorization
 * regardless. It stops shoulder-surfing, not an attacker with the machine.
 */
export function IdleLock({ sharedDevice }: { sharedDevice: boolean }) {
  const [locked, setLocked] = React.useState(false);
  const [warning, setWarning] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const [unlockError, setUnlockError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // Null until mounted — Date.now() during render is impure and would make the
  // component non-idempotent. Seeded in the effect below.
  const lastActivity = React.useRef<number | null>(null);

  /**
   * Handled in a transition rather than useActionState + effect: reacting to
   * success inside an effect would setState during render commit and cascade.
   * Here the state change happens in the submit callback, where it belongs.
   */
  function handleUnlock(formData: FormData) {
    startTransition(async () => {
      const result = await unlockAction(emptyState, formData);
      if (result.ok) {
        lastActivity.current = Date.now();
        setLocked(false);
        setWarning(false);
        setUnlockError(null);
      } else {
        setUnlockError(
          result.fieldErrors?.password?.[0] ??
            result.message ??
            "Incorrect password",
        );
      }
    });
  }

  React.useEffect(() => {
    if (locked) return;

    lastActivity.current ??= Date.now();

    const bump = () => {
      lastActivity.current = Date.now();
      setWarning(false);
    };

    const events = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "pointermove",
    ] as const;
    for (const e of events) {
      window.addEventListener(e, bump, { passive: true });
    }

    const tick = window.setInterval(() => {
      const now = Date.now();
      const since = lastActivity.current ?? now;

      if (shouldLock(since, now, sharedDevice)) {
        setLocked(true);
        setWarning(false);
      } else if (shouldWarn(since, now, sharedDevice)) {
        setWarning(true);
        setSecondsLeft(Math.ceil(msUntilLock(since, now, sharedDevice) / 1000));
      }
    }, 1000);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      window.clearInterval(tick);
    };
  }, [locked, sharedDevice]);

  // Stop the page behind the overlay from scrolling.
  React.useEffect(() => {
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);

  if (warning && !locked) {
    return (
      <div
        role="status"
        className="fixed inset-x-0 bottom-20 z-50 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white shadow-float lg:bottom-6"
      >
        Locking in {secondsLeft}s — move the mouse to stay signed in
      </div>
    );
  }

  if (!locked) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screen locked"
      /* Fully opaque. Nothing behind this may be legible. */
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#dbe7fb] px-4"
    >
      <div className="w-full max-w-[400px]">
        <div className="mb-5 flex flex-col items-center text-center">
          <IconOrb accent="brand" size="xl">
            <Lock className="size-5" />
          </IconOrb>
          <h2 className="mt-3 text-lg font-semibold text-ink">Screen locked</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Locked after {Math.round(idleLimitMs(sharedDevice) / 60000)} minutes
            of inactivity. Your work is still here.
          </p>
        </div>

        <div className="clinical-surface rounded-glass-lg p-5 shadow-raised">
          <form action={handleUnlock} className="space-y-4" noValidate>
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              errors={unlockError ? [unlockError] : undefined}
            />

            {unlockError ? (
              <p
                role="status"
                className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-[#a81c1c]"
              >
                <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
                {unlockError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:focus-ring motion-reduce:active:scale-100"
            >
              {pending ? (
                <>
                  <Loader className="size-4 animate-spin" aria-hidden="true" />
                  Checking…
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  Unlock
                </>
              )}
            </button>
          </form>

          <form action={signOutScopedAction} className="mt-3 text-center">
            <input type="hidden" name="scope" value="local" />
            <button
              type="submit"
              className="rounded text-[13px] font-medium text-ink-secondary hover:text-ink hover:underline focus-visible:focus-ring"
            >
              Sign out instead
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
