"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, requireLocationContext } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import { getQueue } from "./queries";
import {
  priorityInputSchema,
  queueActionSchema,
  type QueueActionState,
  type QueueRow,
} from "./schema";

/**
 * Queue writes.
 *
 * Every one is a database RPC — direct writes on queue_entries are revoked, so
 * these cannot be bypassed and nothing here decides authorisation. The job of
 * this file is to validate input, call the RPC, and turn the database's refusal
 * into a sentence a busy receptionist can act on.
 */

const empty = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

/**
 * The database speaks in constraint language.
 *
 * The IN_CONSULTATION case matters most: it is what a STALE SCREEN produces.
 * Someone else started the consultation while this tab still showed a Call
 * button, so the message has to explain what happened rather than look like a
 * fault.
 */
function translate(message: string): string {
  const m = message.toLowerCase();

  if (m.includes("already with the doctor")) {
    return "That patient is already in with the doctor — the queue has moved on since this screen loaded.";
  }
  if (m.includes("not in the queue")) {
    return "That patient has left the queue — they may have been seen, cancelled or marked as not arrived.";
  }
  if (m.includes("appointment not found")) {
    return "That patient is no longer available to you.";
  }
  if (m.includes("needs a reason")) {
    return "Choose why they are going ahead of the others.";
  }
  return `Could not do that: ${message}`;
}

async function refresh() {
  revalidatePath("/queue");
  revalidatePath("/appointments");
  revalidatePath("/dashboard");
}

export async function callPatientAction(
  _prev: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const parsed = queueActionSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("call_patient", {
    p_appointment_id: parsed.data.appointmentId,
    p_note: empty(formData.get("note")),
  });

  if (error) return { ok: false, message: translate(error.message) };

  await emitAudit({
    action: "queue.called",
    resourceType: "appointment",
    resourceId: parsed.data.appointmentId,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: { callCount: data ?? null },
  });

  await refresh();
  return {
    ok: true,
    appointmentId: parsed.data.appointmentId,
    message: Number(data) > 1 ? `Called again (${data} times).` : "Called.",
  };
}

export async function skipPatientAction(
  _prev: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const parsed = queueActionSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("skip_patient", {
    p_appointment_id: parsed.data.appointmentId,
    p_note: empty(formData.get("note")),
  });

  if (error) return { ok: false, message: translate(error.message) };

  await emitAudit({
    action: "queue.skipped",
    resourceType: "appointment",
    resourceId: parsed.data.appointmentId,
    locationId: ctx.locationId,
    actorId: user.id,
  });

  await refresh();
  return {
    ok: true,
    appointmentId: parsed.data.appointmentId,
    message: "Moved to the missed list — call them again when they appear.",
  };
}

export async function setPriorityAction(
  _prev: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const parsed = priorityInputSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    reason: formData.get("reason"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrors(parsed.error), message: "Choose a reason." };
  }

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("set_queue_priority", {
    p_appointment_id: parsed.data.appointmentId,
    p_reason: parsed.data.reason,
    p_note: empty(formData.get("note")),
  });

  if (error) return { ok: false, message: translate(error.message) };

  await emitAudit({
    action: "queue.priority_set",
    resourceType: "appointment",
    resourceId: parsed.data.appointmentId,
    locationId: ctx.locationId,
    actorId: user.id,
    // The reason is the point of the record — it is a category, not a value.
    meta: { reason: parsed.data.reason },
  });

  await refresh();
  return { ok: true, appointmentId: parsed.data.appointmentId, message: "Moved up the queue." };
}

export async function clearPriorityAction(
  _prev: QueueActionState,
  formData: FormData,
): Promise<QueueActionState> {
  const id = String(formData.get("appointmentId") ?? "");
  if (!id) return { ok: false, message: "Missing patient." };

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("clear_queue_priority", { p_appointment_id: id });
  if (error) return { ok: false, message: translate(error.message) };

  await emitAudit({
    action: "queue.priority_cleared",
    resourceType: "appointment",
    resourceId: id,
    locationId: ctx.locationId,
    actorId: user.id,
  });

  await refresh();
  return { ok: true, appointmentId: id, message: "Back in ordinary order." };
}

/**
 * Re-read the queue for the live screen.
 *
 * A Server Action rather than a route handler so the client can call it
 * directly, and so the read stays on the RLS-checked server path. Realtime only
 * ever says "something changed" — this is what decides what the user sees.
 */
export async function refreshQueueAction(
  sessionDate: string,
): Promise<{ ok: true; rows: QueueRow[] } | { ok: false; reason: string }> {
  const ctx = await requireLocationContext();
  return getQueue(ctx.locationId, sessionDate);
}
