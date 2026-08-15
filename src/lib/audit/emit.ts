import "server-only";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Audit emitter.
 *
 * Append-only: `audit_events` has INSERT and SELECT policies but no UPDATE or
 * DELETE grant for anyone, including clinic admins. An audit trail that a
 * privileged user can edit is not an audit trail.
 *
 * NEVER pass record contents, passwords, tokens, session ids, or AI prompt
 * bodies in `meta`. Log field *names* and identifiers, not values.
 */

export type AuditAction =
  | "auth.signed_up"
  | "auth.signed_in"
  | "auth.signed_out"
  | "auth.sign_in_failed"
  | "auth.password_reset_requested"
  | "auth.password_changed"
  | "profile.created"
  | "profile.updated"
  | "doctor_profile.created"
  | "doctor_profile.updated"
  | "location.created"
  | "location.updated"
  | "location.switched"
  | "location_member.invited"
  | "location_member.role_changed"
  | "location_member.removed"
  // Patients. `meta` carries counts and field NAMES only — never clinical values.
  | "patient.created"
  | "patient.viewed"
  | "patient.updated"
  | "patient.safety_updated"
  | "patient.merged"
  // Account & device security. Never carry a TOTP secret or code in `meta`.
  | "security.mfa_enrolled"
  | "security.mfa_removed"
  | "security.mfa_challenge_passed"
  | "security.mfa_challenge_failed"
  | "security.signed_out_other_devices"
  | "security.signed_out_everywhere"
  | "security.shared_device_selected"
  | "security.locked"
  | "security.unlocked"
  | "security.unlock_failed";

export interface AuditInput {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  locationId?: string | null;
  actorId?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Emitting audit must never break the user's action — a failed log is a
 * monitoring problem, not a reason to fail a sign-in. Failures are reported to
 * the server console and swallowed.
 */
export async function emitAudit(input: AuditInput): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();

    let actorId = input.actorId ?? null;
    if (actorId === null) {
      const { data } = await supabase.auth.getUser();
      actorId = data.user?.id ?? null;
    }

    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null;

    const { error } = await supabase.from("audit_events").insert({
      practice_location_id: input.locationId ?? null,
      actor_id: actorId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      ip,
      user_agent: h.get("user-agent"),
      meta: input.meta ?? {},
    });

    if (error) {
      console.error("[audit] insert failed", input.action, error.message);
    }
  } catch (e) {
    console.error("[audit] emit threw", input.action, e);
  }
}

