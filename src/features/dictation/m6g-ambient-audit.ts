"use server";

import { z } from "zod";
import { emitAudit, type AuditAction } from "@/lib/audit/emit";

const AmbientAuditEvent = z.enum([
  "session_started",
  "session_paused",
  "session_resumed",
  "session_stopped",
  "proposal_created",
  "proposal_reviewed",
  "proposal_rejected",
  "routing_corrected",
]);

const AmbientAuditInput = z.object({
  encounterId: z.string().uuid(),
  locationId: z.string().uuid(),
  event: AmbientAuditEvent,
  target: z.enum(["chiefComplaints", "symptoms", "presentIllness", "pastHistory", "examination", "assessment", "advice", "nextVisitNote", "diagnosis", "investigation", "medicine", "needs-review"]).optional(),
});

export async function recordM6GAmbientAudit(input: z.input<typeof AmbientAuditInput>): Promise<void> {
  const parsed = AmbientAuditInput.safeParse(input);
  if (!parsed.success) return;
  const { encounterId, locationId, event, target } = parsed.data;
  await emitAudit({
    action: `ambient.${event}` as AuditAction,
    resourceType: "encounter",
    resourceId: encounterId,
    locationId,
    meta: target ? { target } : {},
  });
}
