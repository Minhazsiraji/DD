"use client";

import * as React from "react";
import { useActionState } from "react";
import { Plus, X, CircleAlert } from "lucide-react";
import { addSafetyItemAction, removeSafetyItemAction } from "../safety-actions";
import { emptyState } from "@/features/auth/schema";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { cn } from "@/lib/utils";

export interface SafetyItem {
  id: string;
  primary: string;
  secondary?: string;
}

/**
 * An editable clinical list on the patient profile.
 *
 * Exists because an allergy is usually discovered at a LATER visit. Capturing
 * safety information only at registration guarantees the record goes stale in
 * exactly the field where being stale is most dangerous.
 */
export function SafetyList({
  patientId,
  kind,
  title,
  icon,
  items,
  emptyText,
  placeholder,
  danger = false,
}: {
  patientId: string;
  kind: "allergy" | "condition" | "medication" | "alert";
  title: string;
  icon: React.ReactNode;
  items: SafetyItem[];
  emptyText: string;
  placeholder: string;
  danger?: boolean;
}) {
  const [state, formAction] = useActionState(addSafetyItemAction, emptyState);
  // A failed removal must be visible. Logging it to the server console would
  // leave the doctor believing an allergy was withdrawn while it is still live.
  const [removeState, removeAction] = useActionState(
    removeSafetyItemAction,
    emptyState,
  );
  const [adding, setAdding] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  // Clear the field after a successful add so the next one can be typed straight in.
  const succeeded = state.ok;
  React.useEffect(() => {
    if (succeeded) formRef.current?.reset();
  }, [succeeded]);

  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title={title}
        count={items.length}
        icon={icon}
        action={
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-brand hover:bg-brand-soft focus-visible:focus-ring"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add
          </button>
        }
      />

      {removeState.message ? (
        <p
          role="status"
          className="flex items-start gap-2 border-b border-hairline bg-danger-soft px-4 py-2.5 text-[13px] font-medium text-[#a81c1c] sm:px-5"
        >
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          {removeState.message}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="px-4 py-3.5 text-[13px] text-ink-muted sm:px-5">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    danger ? "text-[#a81c1c]" : "text-ink",
                  )}
                >
                  {i.primary}
                </p>
                {i.secondary ? (
                  <p className="text-xs text-ink-secondary">{i.secondary}</p>
                ) : null}
              </div>
              <form action={removeAction}>
                <input type="hidden" name="patientId" value={patientId} />
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={i.id} />
                <button
                  type="submit"
                  aria-label={`Remove ${i.primary}`}
                  className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:focus-ring"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form
          ref={formRef}
          action={formAction}
          className="flex items-start gap-2 border-t border-hairline p-4 sm:p-5"
        >
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="kind" value={kind} />
          <div className="min-w-0 flex-1">
            <label htmlFor={`add-${kind}`} className="sr-only">
              {placeholder}
            </label>
            <input
              id={`add-${kind}`}
              name="value"
              autoComplete="off"
              placeholder={placeholder}
              className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-base text-ink placeholder:text-ink-muted focus-visible:focus-ring"
            />
            {state.fieldErrors?.value ? (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-danger">
                <CircleAlert className="size-3.5" aria-hidden="true" />
                {state.fieldErrors.value[0]}
              </p>
            ) : null}
            {state.message ? (
              <p className="mt-1 text-xs font-medium text-danger">{state.message}</p>
            ) : null}
          </div>
          <button
            type="submit"
            className="h-11 shrink-0 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:focus-ring"
          >
            Save
          </button>
        </form>
      ) : null}
    </SectionCard>
  );
}
