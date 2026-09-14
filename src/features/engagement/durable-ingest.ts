import "server-only";

import { minuteBucket } from "./engagement";
import { engagementBodySchema, type IngestResult } from "./ingest";
import type { EngagementSurface } from "./surfaces";

export interface DurableEngagementDeps {
  now: () => Date;
  resolveDoctorId: (actorUserId: string) => Promise<string | null>;
  recordMinute: (input: {
    doctorId: string;
    minuteBucket: string;
    surface: EngagementSurface;
    clinicTimeZone: string;
  }) => Promise<boolean>;
}

/**
 * F-I2 runtime ingest. The browser contributes one frozen surface label only.
 * Doctor identity, time, timezone and clinic day are all trusted server/DB
 * authorities; no default timezone is permitted on this path.
 */
export async function ingestDurableEngagement(
  body: unknown,
  context: { actorUserId: string; clinicTimeZone: string | null },
  deps: DurableEngagementDeps,
): Promise<IngestResult> {
  const parsed = engagementBodySchema.safeParse(body);
  if (!parsed.success) return { status: "INVALID_BODY" };

  const clinicTimeZone = context.clinicTimeZone?.trim();
  if (!clinicTimeZone) return { status: "FAILED" };

  const doctorId = await deps.resolveDoctorId(context.actorUserId);
  if (!doctorId) return { status: "NOT_A_DOCTOR" };

  const bucket = minuteBucket(deps.now());
  const inserted = await deps.recordMinute({
    doctorId,
    minuteBucket: bucket,
    surface: parsed.data.surface,
    clinicTimeZone,
  });

  // A duplicate heartbeat in the same canonical Doctor/minute/surface is an
  // idempotent success. PostgreSQL returns false only because no new row was
  // inserted; the minute is already durably represented.
  return { status: "RECORDED", rows: inserted ? 1 : 0 };
}
