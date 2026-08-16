"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Trash2, ShieldCheck, CircleAlert } from "lucide-react";
import { emptyState } from "@/features/auth/schema";
import { FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { uploadSignatureAction, removeSignatureAction } from "../actions";

/**
 * Signature upload.
 *
 * The image lives in a PRIVATE bucket and is shown through a short-lived signed
 * URL — a signature is a reusable authorisation mark, so a permanently public
 * link would be a standing forgery risk.
 */
/**
 * `hasSignature` and `signatureUrl` are deliberately separate.
 *
 * A saved signature whose image cannot be fetched — the object was deleted but
 * the reference survived, or signing the URL failed — must still render the
 * Remove button. Keying the whole panel off the URL hid the problem AND the
 * only control that fixes it, leaving the doctor permanently stuck with a
 * reference they could neither see nor clear.
 */
export function SignaturePanel({
  signatureUrl,
  hasSignature,
}: {
  signatureUrl: string | null;
  hasSignature: boolean;
}) {
  const [state, formAction] = useActionState(uploadSignatureAction, emptyState);
  const [removeState, removeAction] = useActionState(removeSignatureAction, emptyState);
  const router = useRouter();

  React.useEffect(() => {
    if (state.ok || removeState.ok) router.refresh();
  }, [state.ok, removeState.ok, router]);

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {hasSignature ? (
        <div className="flex flex-wrap items-center gap-4">
          {signatureUrl ? (
            <div className="rounded-xl border border-hairline bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL */}
              <img src={signatureUrl} alt="Your saved signature" className="h-14 w-auto object-contain" />
            </div>
          ) : (
            <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-[13px] text-ink">
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
              A signature is saved but its image cannot be opened right now. Remove
              it and upload again — until you do, prescriptions may print without one.
            </p>
          )}
          <form action={removeAction}>
            <button
              type="submit"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-hairline bg-white px-3.5 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:focus-ring"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remove
            </button>
          </form>
        </div>
      ) : null}

      {/* Removal reports its own outcome — it can fail, and silently leaving a
          reusable signature in storage is the failure that matters. */}
      <FormMessage state={removeState} />

      {!hasSignature ? (
        <p className="flex items-start gap-2 rounded-xl bg-surface-muted px-3 py-2.5 text-[13px] text-ink-secondary">
          <PenLine className="mt-px size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          No signature yet. Sign a blank white sheet, photograph it in good light
          and upload it — or leave this empty and sign each prescription by hand.
        </p>
      ) : null}

      <form action={formAction} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="field-signature" className="block text-[13px] font-medium text-ink">
            {signatureUrl ? "Replace signature" : "Upload signature"}
          </label>
          <input
            id="field-signature"
            name="signature"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="block w-full cursor-pointer rounded-xl border border-hairline bg-white text-sm text-ink file:mr-3 file:h-11 file:cursor-pointer file:rounded-l-xl file:border-0 file:bg-surface-muted file:px-4 file:text-sm file:font-semibold file:text-ink focus-visible:focus-ring"
          />
          <p className="text-xs text-ink-muted">
            PNG, JPG or WebP, up to 2&nbsp;MB. A PNG with a transparent
            background prints best.
          </p>
        </div>

        <FormMessage state={state} />

        <div className="sm:max-w-48">
          <SubmitButton>Save signature</SubmitButton>
        </div>
      </form>

      <p className="flex items-start gap-2 text-xs text-ink-muted">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        Stored privately. Only you can open it, and the link expires within
        minutes.
      </p>
    </div>
  );
}
