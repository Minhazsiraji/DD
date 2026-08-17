"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLocationContext } from "@/lib/auth/session";
import { getServerState } from "./queries";
import { translateSaveError } from "./errors";
import { CERTAINTIES, type ListResult } from "./list-schema";

/**
 * Diagnosis and investigation writes.
 *
 * Every one is a Stage 6A RPC, so nothing here decides authorisation and
 * nothing here can bypass the version check. The job of this file is to
 * validate input, call the function, and turn a refusal into a sentence.
 *
 * THE VERSION A CALLER MAY CLAIM IS THE ONE IT EARNED. The add functions
 * return the new row's id and increment the version exactly once, so the new
 * version is `expectedVersion + 1` (ADR 0010 §6c, asserted by
 * db:verify:encounters). Re-reading it from the database instead would absorb
 * another device's increment and mask a genuine conflict.
 */

const uuid = z.uuid();
const label = z.string().trim().min(1, "Give the diagnosis a name.").max(300);
const name = z.string().trim().min(1, "Give the investigation a name.").max(300);
const note = z.string().trim().max(2000);

const addDiagnosisSchema = z.object({
  encounterId: uuid,
  expectedVersion: z.number().int().positive(),
  label,
  certainty: z.enum(CERTAINTIES),
  note: note.optional(),
});

const updateDiagnosisSchema = z.object({
  encounterId: uuid,
  expectedVersion: z.number().int().positive(),
  diagnosisId: uuid,
  label: label.optional(),
  certainty: z.enum(CERTAINTIES).optional(),
  /** null is an explicit CLEAR; absent leaves the note alone. */
  note: note.nullable().optional(),
});

const addInvestigationSchema = z.object({
  encounterId: uuid,
  expectedVersion: z.number().int().positive(),
  name,
  note: note.optional(),
});

const updateInvestigationSchema = z.object({
  encounterId: uuid,
  expectedVersion: z.number().int().positive(),
  investigationId: uuid,
  name: name.optional(),
  note: note.nullable().optional(),
});

const removeSchema = z.object({
  encounterId: uuid,
  expectedVersion: z.number().int().positive(),
  rowId: uuid,
});

/**
 * One exit for every list mutation.
 *
 * A refusal is translated, an unrecognised one is logged server-side and
 * replaced with a stable sentence, and a conflict carries the encounter's
 * CURRENT state so the screen can show the doctor what moved rather than
 * asking them to decide blind.
 */
async function finish(
  action: string,
  encounterId: string,
  locationId: string,
  error: { message: string } | null,
  version: number,
): Promise<ListResult> {
  if (!error) return { ok: true, version };

  const translated = translateSaveError(error.message);
  if (translated.unexpected) {
    // Server-side only — this is the detail we deliberately do not render.
    console.error(`[encounters] ${action} failed`, error.message);
  }

  if (translated.kind === "conflict") {
    const server = await getServerState(encounterId, locationId);
    if (!server) {
      return {
        ok: false,
        kind: "error",
        message:
          "This consultation changed somewhere else, and the newer version could not be loaded. Nothing here has been lost — reload before trying again.",
      };
    }
    return { ok: false, kind: "conflict", message: translated.message, server };
  }

  return { ok: false, kind: "error", message: translated.message };
}

function invalid(error: z.ZodError): ListResult {
  return {
    ok: false,
    kind: "error",
    message: error.issues[0]?.message ?? "Those details could not be saved.",
  };
}

/** Trimmed-empty is no note at all, never a stored blank. */
const asNote = (value: string | null | undefined) =>
  value === null ? null : value && value.trim() !== "" ? value.trim() : null;

export async function addDiagnosisAction(input: unknown): Promise<ListResult> {
  const parsed = addDiagnosisSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("add_encounter_diagnosis", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_label: parsed.data.label,
    p_certainty: parsed.data.certainty,
    p_note: asNote(parsed.data.note),
  });

  return finish(
    "add_encounter_diagnosis",
    parsed.data.encounterId,
    ctx.locationId,
    error,
    parsed.data.expectedVersion + 1,
  );
}

export async function updateDiagnosisAction(input: unknown): Promise<ListResult> {
  const parsed = updateDiagnosisSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  // Absent means untouched; null means cleared. Only what changed is sent.
  const patch: Record<string, string | null> = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.certainty !== undefined) patch.certainty = parsed.data.certainty;
  if (parsed.data.note !== undefined) patch.note = asNote(parsed.data.note);

  if (Object.keys(patch).length === 0) {
    return { ok: false, kind: "error", message: "Nothing has changed." };
  }

  const { data, error } = await supabase.rpc("update_encounter_diagnosis", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_diagnosis_id: parsed.data.diagnosisId,
    p_patch: patch,
  });

  return finish(
    "update_encounter_diagnosis",
    parsed.data.encounterId,
    ctx.locationId,
    error,
    Number(data) || parsed.data.expectedVersion + 1,
  );
}

export async function removeDiagnosisAction(input: unknown): Promise<ListResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("remove_encounter_diagnosis", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_diagnosis_id: parsed.data.rowId,
  });

  return finish(
    "remove_encounter_diagnosis",
    parsed.data.encounterId,
    ctx.locationId,
    error,
    Number(data) || parsed.data.expectedVersion + 1,
  );
}

export async function addInvestigationAction(input: unknown): Promise<ListResult> {
  const parsed = addInvestigationSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("add_encounter_investigation", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_name: parsed.data.name,
    p_note: asNote(parsed.data.note),
  });

  return finish(
    "add_encounter_investigation",
    parsed.data.encounterId,
    ctx.locationId,
    error,
    parsed.data.expectedVersion + 1,
  );
}

export async function updateInvestigationAction(input: unknown): Promise<ListResult> {
  const parsed = updateInvestigationSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const patch: Record<string, string | null> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.note !== undefined) patch.note = asNote(parsed.data.note);

  if (Object.keys(patch).length === 0) {
    return { ok: false, kind: "error", message: "Nothing has changed." };
  }

  const { data, error } = await supabase.rpc("update_encounter_investigation", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_investigation_id: parsed.data.investigationId,
    p_patch: patch,
  });

  return finish(
    "update_encounter_investigation",
    parsed.data.encounterId,
    ctx.locationId,
    error,
    Number(data) || parsed.data.expectedVersion + 1,
  );
}

export async function removeInvestigationAction(input: unknown): Promise<ListResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await requireLocationContext();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("remove_encounter_investigation", {
    p_encounter_id: parsed.data.encounterId,
    p_practice_location_id: ctx.locationId,
    p_expected_version: parsed.data.expectedVersion,
    p_investigation_id: parsed.data.rowId,
  });

  return finish(
    "remove_encounter_investigation",
    parsed.data.encounterId,
    ctx.locationId,
    error,
    Number(data) || parsed.data.expectedVersion + 1,
  );
}

/**
 * Re-read the encounter after a successful list mutation.
 *
 * The RPCs return a version, not rows, and positions shift when something is
 * removed — so the list is re-read rather than patched locally. Guessing at the
 * new order would let the screen and the record disagree about what a doctor
 * wrote down.
 */
export async function refreshListsAction(encounterId: string) {
  const ctx = await requireLocationContext();
  const server = await getServerState(encounterId, ctx.locationId);
  if (!server) return { ok: false as const };
  return { ok: true as const, server };
}
