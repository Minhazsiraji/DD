"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, requireLocationContext } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import type { ActionState } from "@/features/auth/schema";

/**
 * Patient safety information — allergies, conditions, medications, alerts.
 *
 * These must be editable AFTER registration. An allergy is most often
 * discovered at a later visit, and a record that can only capture it at
 * registration is a record that will be wrong.
 *
 * Writes are restricted to the owning doctor by RLS: this is clinical content,
 * not front-desk data.
 */

const TABLES = {
  allergy: { table: "patient_allergies", column: "substance" },
  condition: { table: "patient_conditions", column: "condition" },
  medication: { table: "patient_medications", column: "name" },
  alert: { table: "patient_alerts", column: "message" },
} as const;

type SafetyKind = keyof typeof TABLES;

function isKind(v: string): v is SafetyKind {
  return v in TABLES;
}

export async function addSafetyItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const patientId = String(formData.get("patientId") ?? "");
  const kindRaw = String(formData.get("kind") ?? "");
  const value = String(formData.get("value") ?? "").trim();

  if (!patientId || !isKind(kindRaw)) {
    return { ok: false, message: "Something went wrong. Please try again." };
  }
  if (value.length === 0) {
    return { ok: false, fieldErrors: { value: ["Enter a value"] } };
  }
  if (value.length > 200) {
    return { ok: false, fieldErrors: { value: ["That is too long"] } };
  }

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { table, column } = TABLES[kindRaw];

  const row: Record<string, unknown> = { patient_id: patientId, [column]: value };
  if (kindRaw === "allergy") row.recorded_by = user.id;
  if (kindRaw === "alert") row.created_by = user.id;
  if (kindRaw === "medication") row.source = "REPORTED";

  const { error } = await supabase.from(table).insert(row);
  if (error) {
    return { ok: false, message: `Could not save: ${error.message}` };
  }

  await emitAudit({
    // Allergies are the highest-consequence safety field; audit them distinctly.
    action: kindRaw === "allergy" ? "patient.safety_updated" : "patient.updated",
    resourceType: "patient",
    resourceId: patientId,
    locationId: ctx.locationId,
    actorId: user.id,
    // The KIND only. The value is clinical content and stays out of the audit.
    meta: { added: kindRaw },
  });

  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}

export async function removeSafetyItemAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get("patientId") ?? "");
  const kindRaw = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!patientId || !id || !isKind(kindRaw)) return;

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from(TABLES[kindRaw].table).delete().eq("id", id);
  if (error) {
    console.error("[patients] safety item delete failed", error.message);
    return;
  }

  await emitAudit({
    action: kindRaw === "allergy" ? "patient.safety_updated" : "patient.updated",
    resourceType: "patient",
    resourceId: patientId,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: { removed: kindRaw },
  });

  revalidatePath(`/patients/${patientId}`);
}
