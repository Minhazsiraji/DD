"use server";

import { cookies } from "next/headers";
import { ACTIVE_CLINIC_COOKIE, getMemberships, requireUser } from "@/lib/auth/session";
import { emitAudit } from "@/lib/audit/emit";
import { forbidden } from "@/lib/errors";

/**
 * Set the active clinic.
 *
 * The requested id is verified against the caller's ACTIVE memberships before
 * the cookie is written. Never trust the cookie on read either — see
 * requireClinicContext, which re-checks membership on every request. A cookie
 * the user can edit must never by itself grant access to a clinic.
 */
export async function switchClinicAction(clinicId: string): Promise<void> {
  const user = await requireUser();
  const memberships = await getMemberships();

  const target = memberships.find((m) => m.clinicId === clinicId);
  if (!target) {
    throw forbidden("attempted to switch to a clinic the user is not a member of");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLINIC_COOKIE, clinicId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  await emitAudit({
    action: "clinic.switched",
    resourceType: "clinic",
    resourceId: clinicId,
    clinicId,
    actorId: user.id,
  });
}
