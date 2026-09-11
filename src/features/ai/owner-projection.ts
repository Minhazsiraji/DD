import "server-only";

import {
  microsDecimalToPicousd,
  minorDecimalToPicousd,
  picousdToMinorDecimal,
  sumOrUnknown,
  type Picousd,
} from "./money";
import { deriveTerminalOutcome } from "./proposal-decision";
import type {
  AiOperationStartedEvent,
  AiProposalDecisionEvent,
  AiProposalProducedEvent,
  AiProviderAttemptedEvent,
  AiProviderOutcomeEvent,
  AiTelemetryEvent,
  VoiceGrantEvent,
  VoiceSessionReportedEvent,
} from "./telemetry";

/**
 * O1-E → O1-F aggregate projection.
 *
 * O1-F-ARCH-01 IS NORMATIVE. Every row carries exactly these ten columns and
 * nothing else — no operation id, no latency, no failure code, no task type,
 * no measurement quality. What cannot be expressed in ten columns stays in the
 * O1-E event store and never reaches an Owner.
 *
 * This function applies NO consent gating and NO k=5 suppression. Both belong
 * to O1-F; doing either here would be a second consent system. It emits at
 * per-Doctor grain precisely so O1-F can count distinct Doctors.
 *
 * COST TRUTH (O1-E-R3)
 *   estimated_cost_minor is exact fixed point, scale 10, never rounded. A
 *   300-micro cost is "0.0300000000" — not 0, and not 1.
 *   If ANY event contributing to a bucket has an unknown cost, the bucket's
 *   cost is NULL. A partial known sum is never emitted in the total position.
 *   event_count counts every contributor, known or not; quantity_total sums
 *   the known quantities, and is NULL when none is known.
 *
 * COST-BEARING ROWS
 *   Billable meters are disjoint: INPUT_TOKENS is the UNCACHED input only, so
 *   it and CACHED_INPUT_TOKENS never overlap. Reasoning tokens are a subset of
 *   output and do not cross at all. Count rows carry an authoritative zero.
 *   SUM(estimated_cost_minor) over a complete slice is therefore exact.
 */

export const OWNER_AGGREGATE_COLUMNS = [
  "period_day",
  "principal_doctor_id",
  "provider_id",
  "service_kind",
  "model_id",
  "unit",
  "quantity_total",
  "event_count",
  "estimated_cost_minor",
  "currency_code",
] as const;

export const OWNER_BILLABLE_UNITS = [
  "INPUT_TOKENS",
  "CACHED_INPUT_TOKENS",
  "OUTPUT_TOKENS",
  "AUDIO_MILLIS",
] as const;

export const OWNER_COUNT_UNITS = [
  "OPERATIONS",
  "PROVIDER_CALLS",
  "VOICE_GRANTS",
  "PROPOSALS_PRODUCED",
  "PROPOSALS_ACCEPTED",
  "PROPOSALS_EDITED",
  "PROPOSALS_REJECTED",
  "PROPOSALS_EXPIRED",
] as const;

export type OwnerUnit =
  | (typeof OWNER_BILLABLE_UNITS)[number]
  | (typeof OWNER_COUNT_UNITS)[number];
export type ServiceKind = "AI_PROPOSAL" | "VOICE_STT";

export interface OwnerAggregateRow {
  period_day: string;
  principal_doctor_id: string | null;
  provider_id: string;
  service_kind: ServiceKind;
  model_id: string;
  unit: OwnerUnit;
  quantity_total: number | null;
  event_count: number;
  estimated_cost_minor: string | null;
  currency_code: "USD";
}

export interface OwnerProjectionOptions {
  /** One declared reporting timezone for day bucketing. Required: never defaulted. */
  timeZone: string;
  /**
   * Voice events carry the auth user, not the Doctor profile. The caller
   * resolves one to the other; an unresolvable actor projects as null.
   */
  principalOfActor?: (actorUserId: string) => string | null;
}

interface Bucket {
  key: Omit<OwnerAggregateRow, "quantity_total" | "event_count" | "estimated_cost_minor" | "currency_code">;
  quantity: number;
  anyQuantityKnown: boolean;
  eventCount: number;
  costs: (Picousd | null)[];
}

const ZERO = BigInt(0);
const AI_METERS = ["INPUT_TOKENS", "CACHED_INPUT_TOKENS", "OUTPUT_TOKENS"] as const;

const DECISION_UNIT = {
  ACCEPTED: "PROPOSALS_ACCEPTED",
  EDITED: "PROPOSALS_EDITED",
  REJECTED: "PROPOSALS_REJECTED",
  EXPIRED: "PROPOSALS_EXPIRED",
} as const;
const DECISION_EVENT = {
  ACCEPTED: "AI_PROPOSAL_ACCEPTED",
  EDITED: "AI_PROPOSAL_EDITED",
  REJECTED: "AI_PROPOSAL_REJECTED",
  EXPIRED: "AI_PROPOSAL_EXPIRED",
} as const;

const microsOrNull = (value: string | null): Picousd | null =>
  value === null ? null : microsDecimalToPicousd(value);

export function projectOwnerAggregates(
  input: readonly AiTelemetryEvent[],
  options: OwnerProjectionOptions,
): OwnerAggregateRow[] {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayOf = (iso: string): string => {
    const parts = formatter.formatToParts(new Date(iso));
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const principalOf = (actor: string | null): string | null =>
    actor === null ? null : (options.principalOfActor?.(actor) ?? null);

  // Exactly-once, even if the store somehow held duplicates: first key wins.
  const events: AiTelemetryEvent[] = [];
  const seen = new Set<string>();
  for (const event of input) {
    if (seen.has(event.event_key)) continue;
    seen.add(event.event_key);
    events.push(event);
  }
  const ofType = <T extends AiTelemetryEvent>(type: T["event_type"]) =>
    events.filter((event): event is T => event.event_type === type);

  const buckets = new Map<string, Bucket>();
  const contribute = (
    key: Bucket["key"],
    quantity: number | null,
    cost: Picousd | null,
  ): void => {
    const id = JSON.stringify([
      key.period_day,
      key.principal_doctor_id,
      key.provider_id,
      key.service_kind,
      key.model_id,
      key.unit,
    ]);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { key, quantity: 0, anyQuantityKnown: false, eventCount: 0, costs: [] };
      buckets.set(id, bucket);
    }
    bucket.eventCount += 1;
    if (quantity !== null) {
      bucket.quantity += quantity;
      if (!Number.isSafeInteger(bucket.quantity)) throw new Error("OWNER_QUANTITY_OVERFLOW");
      bucket.anyQuantityKnown = true;
    }
    bucket.costs.push(cost);
  };
  const countRow = (key: Bucket["key"]) => contribute(key, 1, ZERO);

  // ---- AI: operations and provider calls ---------------------------------
  for (const started of ofType<AiOperationStartedEvent>("AI_OPERATION_STARTED")) {
    countRow({
      period_day: dayOf(started.occurred_at),
      principal_doctor_id: started.doctor_profile_id,
      provider_id: started.provider_id,
      service_kind: "AI_PROPOSAL",
      model_id: started.model_id,
      unit: "OPERATIONS",
    });
  }

  const attempts = ofType<AiProviderAttemptedEvent>("AI_PROVIDER_ATTEMPTED");
  const outcomes = new Map<string, AiProviderOutcomeEvent>();
  for (const event of events) {
    if (
      event.event_type === "AI_PROVIDER_SUCCEEDED" ||
      event.event_type === "AI_PROVIDER_FAILED" ||
      event.event_type === "AI_PROVIDER_TIMEOUT"
    ) {
      outcomes.set(`${event.operation_id}:${event.attempt_no}`, event);
    }
  }

  // Every attempt contributes to the billable meters. An attempt with no
  // outcome is in flight or orphaned — either way its consumption is unknown,
  // which is exactly what makes the bucket NULL until it resolves.
  const meteredAttempts = new Set<string>();
  const meter = (
    anchor: AiProviderAttemptedEvent | AiProviderOutcomeEvent,
    outcome: AiProviderOutcomeEvent | undefined,
  ): void => {
    if (outcome?.usage_state === "NOT_APPLICABLE") return; // never dispatched: nothing consumed
    const key = (unit: OwnerUnit): Bucket["key"] => ({
      period_day: dayOf(anchor.occurred_at),
      principal_doctor_id: anchor.doctor_profile_id,
      provider_id: anchor.provider_id,
      service_kind: "AI_PROPOSAL",
      model_id: anchor.model_id,
      unit,
    });
    if (!outcome || outcome.usage_state !== "REPORTED") {
      for (const unit of AI_METERS) contribute(key(unit), null, null);
      return;
    }
    const input = outcome.input_tokens;
    const cached = outcome.cached_input_tokens;
    contribute(
      key("INPUT_TOKENS"),
      input !== null && cached !== null ? input - cached : null,
      microsOrNull(outcome.input_cost_usd_micros),
    );
    contribute(key("CACHED_INPUT_TOKENS"), cached, microsOrNull(outcome.cached_input_cost_usd_micros));
    contribute(key("OUTPUT_TOKENS"), outcome.output_tokens, microsOrNull(outcome.output_cost_usd_micros));
  };

  for (const attempt of attempts) {
    const id = `${attempt.operation_id}:${attempt.attempt_no}`;
    meteredAttempts.add(id);
    countRow({
      period_day: dayOf(attempt.occurred_at),
      principal_doctor_id: attempt.doctor_profile_id,
      provider_id: attempt.provider_id,
      service_kind: "AI_PROPOSAL",
      model_id: attempt.model_id,
      unit: "PROVIDER_CALLS",
    });
    meter(attempt, outcomes.get(id));
  }
  // An outcome whose attempt record was lost still consumed what it consumed.
  for (const [id, outcome] of outcomes) {
    if (!meteredAttempts.has(id)) meter(outcome, outcome);
  }

  // ---- AI: proposals and terminal decisions -------------------------------
  const decisions = events.filter(
    (event): event is AiProposalDecisionEvent =>
      event.event_type === "AI_PROPOSAL_ACCEPTED" ||
      event.event_type === "AI_PROPOSAL_EDITED" ||
      event.event_type === "AI_PROPOSAL_REJECTED" ||
      event.event_type === "AI_PROPOSAL_EXPIRED",
  );
  for (const produced of ofType<AiProposalProducedEvent>("AI_PROPOSAL_PRODUCED")) {
    const attribution = {
      principal_doctor_id: produced.doctor_profile_id,
      provider_id: produced.provider_id,
      service_kind: "AI_PROPOSAL" as const,
      model_id: produced.model_id,
    };
    countRow({ ...attribution, period_day: dayOf(produced.occurred_at), unit: "PROPOSALS_PRODUCED" });

    // Only a decision by the Doctor the proposal was produced for counts. A
    // proposal id presented by anyone else — forged or misrouted — is ignored.
    const own = decisions.filter(
      (event) =>
        event.proposal_id === produced.proposal_id &&
        event.doctor_profile_id === produced.doctor_profile_id,
    );
    const terminal = deriveTerminalOutcome(own, produced.proposal_id);
    if (terminal === "PENDING") continue;
    const decided = own.find((event) => event.event_type === DECISION_EVENT[terminal])!;
    countRow({ ...attribution, period_day: dayOf(decided.occurred_at), unit: DECISION_UNIT[terminal] });
  }

  // ---- Voice --------------------------------------------------------------
  const issued = ofType<VoiceGrantEvent>("VOICE_GRANT_ISSUED");
  const sessions = ofType<VoiceSessionReportedEvent>("VOICE_SESSION_REPORTED").sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.event_key.localeCompare(b.event_key),
  );
  // One grant is one streaming session. The earliest report for a grant is
  // taken; a second report for the same grant cannot be legitimate.
  const sessionByGrant = new Map<string, VoiceSessionReportedEvent>();
  for (const session of sessions) {
    if (!sessionByGrant.has(session.grant_id)) sessionByGrant.set(session.grant_id, session);
  }
  const issuedIds = new Set(issued.map((grant) => grant.grant_id));

  const audioKey = (anchor: VoiceGrantEvent | VoiceSessionReportedEvent, unit: OwnerUnit) => ({
    period_day: dayOf(anchor.occurred_at),
    principal_doctor_id: principalOf(anchor.actor_user_id),
    provider_id: anchor.provider_id,
    service_kind: "VOICE_STT" as const,
    model_id: anchor.model_id,
    unit,
  });

  for (const grant of issued) {
    countRow(audioKey(grant, "VOICE_GRANTS"));
    const session = sessionByGrant.get(grant.grant_id);
    // An issued grant with no report is an UNMEASURED session. Its audio, and
    // so its cost, is unknown — and that makes the bucket's cost NULL.
    if (!session) {
      contribute(audioKey(grant, "AUDIO_MILLIS"), null, null);
      continue;
    }
    contribute(
      audioKey(grant, "AUDIO_MILLIS"),
      session.streamed_audio_ms,
      microsOrNull(session.estimated_cost_usd_micros),
    );
  }
  // A report whose grant record is missing is still measured audio.
  for (const [grantId, session] of sessionByGrant) {
    if (issuedIds.has(grantId)) continue;
    contribute(
      audioKey(session, "AUDIO_MILLIS"),
      session.streamed_audio_ms,
      microsOrNull(session.estimated_cost_usd_micros),
    );
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, bucket]) => {
      const total = sumOrUnknown(bucket.costs);
      const row: OwnerAggregateRow = {
        period_day: bucket.key.period_day,
        principal_doctor_id: bucket.key.principal_doctor_id,
        provider_id: bucket.key.provider_id,
        service_kind: bucket.key.service_kind,
        model_id: bucket.key.model_id,
        unit: bucket.key.unit,
        quantity_total: bucket.anyQuantityKnown ? bucket.quantity : null,
        event_count: bucket.eventCount,
        estimated_cost_minor: total === null ? null : picousdToMinorDecimal(total),
        currency_code: "USD",
      };
      return row;
    });
}

/**
 * Exact sum of a slice of projected rows. NULL if any row's cost is NULL —
 * the same rule, one level up: a slice with one unknown bucket has an unknown
 * total, never the total of its known buckets.
 */
export function sumOwnerCostMinor(rows: readonly OwnerAggregateRow[]): string | null {
  const total = sumOrUnknown(
    rows.map((row) =>
      row.estimated_cost_minor === null ? null : minorDecimalToPicousd(row.estimated_cost_minor),
    ),
  );
  return total === null ? null : picousdToMinorDecimal(total);
}
