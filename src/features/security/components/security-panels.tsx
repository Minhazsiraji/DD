"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Trash2,
  LogOut,
  MonitorSmartphone,
  TriangleAlert,
} from "lucide-react";
import { removeFactorAction, signOutScopedAction, type Factor } from "../actions";
import { emptyState } from "@/features/auth/schema";
import { FormMessage } from "@/features/auth/components/form-parts";
import { MfaSetup } from "./mfa-setup";
import { canAddBackupFactor, hasVerifiedFactor, isLastVerifiedFactor } from "../policy";
import { cn } from "@/lib/utils";

export function MfaPanel({ factors }: { factors: Factor[] }) {
  const [state, removeAction] = useActionState(removeFactorAction, emptyState);
  const [addingBackup, setAddingBackup] = React.useState(false);
  const router = useRouter();
  const verified = factors.filter((f) => f.status === "verified");
  const enabled = hasVerifiedFactor(factors);

  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl px-3 py-2.5",
          enabled ? "bg-success-soft" : "bg-warning-soft",
        )}
      >
        {enabled ? (
          <ShieldCheck className="mt-px size-4 shrink-0 text-[#07684a]" aria-hidden="true" />
        ) : (
          <ShieldOff className="mt-px size-4 shrink-0 text-[#8a3f07]" aria-hidden="true" />
        )}
        <p
          className={cn(
            "text-[13px] font-semibold",
            enabled ? "text-[#07684a]" : "text-[#8a3f07]",
          )}
        >
          {enabled
            ? "Two-step verification is ON"
            : "Two-step verification is OFF — your account is protected by a password alone"}
        </p>
      </div>

      {verified.length > 0 ? (
        <ul className="divide-y divide-hairline rounded-xl border border-hairline">
          {verified.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
              <Smartphone className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">
                  {f.friendlyName}
                </p>
                {isLastVerifiedFactor(factors, f.id) ? (
                  <p className="text-[11px] text-ink-muted">
                    Your only authenticator
                  </p>
                ) : null}
              </div>
              <form action={removeAction}>
                <input type="hidden" name="factorId" value={f.id} />
                <button
                  type="submit"
                  aria-label={`Remove ${f.friendlyName}`}
                  className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:focus-ring"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      <FormMessage state={state} />

      {!enabled ? (
        <MfaSetup />
      ) : canAddBackupFactor(factors) ? (
        addingBackup ? (
          <div className="rounded-xl border border-hairline p-3">
            <MfaSetup isBackup onDone={() => setAddingBackup(false)} />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-[13px] text-ink-secondary">
              <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
              You have one authenticator. If you lose that phone you lose access
              — Supabase does not issue recovery codes, so a second factor on
              another device is the only way back in.
            </p>
            <button
              type="button"
              onClick={() => setAddingBackup(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-brand bg-white px-4 text-sm font-semibold text-brand transition-colors hover:bg-brand-soft focus-visible:focus-ring"
            >
              Add a backup authenticator
            </button>
          </div>
        )
      ) : (
        <p className="text-[13px] text-ink-secondary">
          You have a primary and a backup authenticator. That is the recommended
          setup.
        </p>
      )}
    </div>
  );
}

export function SignOutPanel({ sharedDevice }: { sharedDevice: boolean }) {
  return (
    <div className="space-y-3 p-4 sm:p-5">
      {sharedDevice ? (
        <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] font-medium text-[#8a3f07]">
          <MonitorSmartphone className="mt-px size-4 shrink-0" aria-hidden="true" />
          This browser is marked as a shared computer. It locks after 10 minutes
          of inactivity.
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <form action={signOutScopedAction}>
          <input type="hidden" name="scope" value="local" />
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            <LogOut className="size-4" aria-hidden="true" />
            This device
          </button>
        </form>

        <form action={signOutScopedAction}>
          <input type="hidden" name="scope" value="others" />
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            Other devices
          </button>
        </form>

        <form action={signOutScopedAction}>
          <input type="hidden" name="scope" value="global" />
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-danger bg-white px-3 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:focus-ring"
          >
            Everywhere
          </button>
        </form>
      </div>

      <p className="text-xs text-ink-muted">
        Lost a phone? Use <strong className="text-ink-secondary">Other devices</strong> —
        it ends every session except this one, and you stay signed in here.
      </p>
    </div>
  );
}
