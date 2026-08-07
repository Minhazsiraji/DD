"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ShieldCheck, Copy, Check } from "lucide-react";
import { startEnrollAction, verifyEnrollAction, type EnrollResult } from "../actions";
import { emptyState } from "@/features/auth/schema";
import { Field, FormMessage, SubmitButton } from "@/features/auth/components/form-parts";

const startState: EnrollResult = { ok: false };

/**
 * TOTP enrolment.
 *
 * Supabase returns the QR as an SVG data URI, so no QR library is required.
 * The manual secret is shown as a fallback for apps that cannot scan and for
 * enrolling a backup on a second phone.
 */
export function MfaSetup({
  isBackup = false,
  onDone,
}: {
  isBackup?: boolean;
  onDone?: () => void;
}) {
  const [enroll, startAction] = useActionState(startEnrollAction, startState);
  const [verify, verifyAction] = useActionState(verifyEnrollAction, emptyState);
  const [copied, setCopied] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    if (verify.ok) {
      router.refresh();
      onDone?.();
    }
  }, [verify.ok, router, onDone]);

  async function copySecret() {
    if (!enroll.secret) return;
    try {
      await navigator.clipboard.writeText(enroll.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the secret is visible on screen regardless.
    }
  }

  if (!enroll.ok || !enroll.qrCode) {
    return (
      <form action={startAction} className="space-y-3">
        <input
          type="hidden"
          name="friendlyName"
          value={isBackup ? "Backup authenticator" : "Primary authenticator"}
        />
        <p className="text-[13px] text-ink-secondary">
          {isBackup
            ? "Add a second authenticator on another phone or app. This is your backup — Supabase does not provide recovery codes, so a second factor is the only way back in if you lose your main device."
            : "Use an authenticator app on your personal phone (Google Authenticator, Authy, 1Password, Microsoft Authenticator)."}
        </p>
        <FormMessage state={enroll} />
        <SubmitButton>
          {isBackup ? "Add backup authenticator" : "Set up authenticator"}
        </SubmitButton>
      </form>
    );
  }

  return (
    <form action={verifyAction} className="space-y-4">
      <input type="hidden" name="factorId" value={enroll.factorId} />

      <ol className="space-y-3 text-[13px] text-ink-secondary">
        <li>
          <strong className="text-ink">1.</strong> Scan this with your
          authenticator app.
          <div className="mt-2 inline-block rounded-xl border border-hairline bg-white p-2">
            {/* Supabase returns an SVG data URI. */}
            <Image
              src={enroll.qrCode}
              alt="QR code for authenticator app enrolment"
              width={180}
              height={180}
              unoptimized
            />
          </div>
        </li>

        <li>
          <strong className="text-ink">2.</strong> Can&apos;t scan? Enter this
          key manually:
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-surface-muted px-2.5 py-2 font-mono text-xs break-all text-ink">
              {enroll.secret}
            </code>
            <button
              type="button"
              onClick={copySecret}
              aria-label="Copy setup key"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-white text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:focus-ring"
            >
              {copied ? (
                <Check className="size-4 text-success" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </li>

        <li>
          <strong className="text-ink">3.</strong> Enter the 6-digit code it
          shows.
        </li>
      </ol>

      <Field
        label="6-digit code"
        name="code"
        type="text"
        autoComplete="one-time-code"
        errors={verify.fieldErrors?.code}
      />

      <FormMessage state={verify} />
      <SubmitButton>
        <ShieldCheck className="size-4" aria-hidden="true" />
        Turn on two-step verification
      </SubmitButton>
    </form>
  );
}
