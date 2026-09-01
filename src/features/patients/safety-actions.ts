"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, requireLocationContext } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import type { ActionState } from "@/features/auth/schema";

const TABLES = {
  allergy: { table: "patient_allergies", column: "substance" },
  condition: { table: "patient_conditions", column: "condition" },
  medication: { table: "patient_medications", column: "name" },
  alert: { table: "patient_alerts", column: "message" },
} as const;

type SafetyKind = keyof typeof TABLES;

const NO_KNOWN_ALLERGY = /^(?:none|none known|no known|no known allerg(?:y|ies)|no known drug allerg(?:y|ies)|nka|nkda)$/i;

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
  if (kindRaw === "allergy" && NO_KNOWN_ALLERGY.test(value)) {
    return {
      ok: false,
      fieldErrors: {
        value: ["If there is no known allergy, leave the allergy list empty."],
      },
    };
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
    action: kindRaw === "allergy" ? "patient.safety_updated" : "patient.updated",
    resourceType: "patient",
    resourceId: patientId,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: { added: kindRaw },
  });

  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}

export async function removeSafetyItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const patientId = String(formData.get("patientId") ?? "");
  const kindRaw = String(formData.get("kind") ?? "");
  const id = String(formData.get("id") ?? "");

  if (!patientId || !id || !isKind(kindRaw)) {
    return { ok: false, message: "Something went wrong. Please try again." };
  }

  const user = await requireUser();
  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { table } = TABLES[kindRaw];

  const { data: deleted, error } = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("patient_id", patientId)
    .select("id, patient_id");

  if (error) {
    console.error("[patients] safety item delete failed", error.message);
    return { ok: false, message: `Could not remove it: ${error.message}` };
  }

  if (!deleted || deleted.length === 0) {
    return {
      ok: false,
      message: "That entry was not removed. Refresh the page and try again.",
    };
  }

  await emitAudit({
    action: kindRaw === "allergy" ? "patient.safety_updated" : "patient.updated",
    resourceType: "patient",
    resourceId: (deleted[0] as { patient_id: string }).patient_id,
    locationId: ctx.locationId,
    actorId: user.id,
    meta: { removed: kindRaw },
  });

  revalidatePath(`/patients/${patientId}`);
  return { ok: true };
}
