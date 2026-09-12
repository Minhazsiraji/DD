/**
 * Voice usage accounting — browser side.
 *
 * Browser→Deepgram streaming is direct: DD's server issues a short grant and
 * never sees the audio. The only party that can measure how much audio was
 * streamed is the browser, so it reports that measurement once per session —
 * as an ESTIMATE, labelled as such by the server that receives it.
 *
 * THIS MODULE CARRIES NO TRANSCRIPT AND NO CLINICAL IDENTIFIER. The report is
 * a session id, a grant id, a duration and two latencies. Nothing typed,
 * spoken or recorded about a patient passes through it, and the server rejects
 * any report carrying a field outside that list.
 *
 * It is deliberately NOT part of the streaming transport (./provider): that
 * module talks to the token route and Deepgram and nothing else.
 */

export interface VoiceStreamUsage {
  voiceSessionId: string;
  /** The grant this session streamed under; null if no grant was ever obtained. */
  grantId: string | null;
  /** Audio actually sent to the provider, in ms. 0 when nothing was sent. */
  streamedAudioMs: number;
  connectLatencyMs: number | null;
  firstResultLatencyMs: number | null;
}

export const VOICE_USAGE_ROUTE = "/api/ai/voice-usage";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const GRANT_ID_RE = new RegExp(`^ddgr_${UUID}$`);

function randomUuidV4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Random and namespaced — never derived from anything about the patient or visit. */
export function mintVoiceSessionId(): string {
  return `ddvs_${randomUuidV4()}`;
}

/** A grant id from the token route, or null if it is not exactly the minted shape. */
export function parseGrantId(value: unknown): string | null {
  return typeof value === "string" && GRANT_ID_RE.test(value) ? value : null;
}

/**
 * The exact report body. Null when there is nothing to report: with no grant,
 * no audio can have reached the provider, so there is no usage to account.
 */
export function voiceUsageBeaconBody(usage: VoiceStreamUsage): Record<string, number | string> | null {
  if (usage.grantId === null) return null;
  const body: Record<string, number | string> = {
    voice_session_id: usage.voiceSessionId,
    grant_id: usage.grantId,
    streamed_audio_ms: Math.max(0, Math.round(usage.streamedAudioMs)),
  };
  if (usage.connectLatencyMs !== null) body.connect_latency_ms = Math.round(usage.connectLatencyMs);
  if (usage.firstResultLatencyMs !== null) {
    body.first_result_latency_ms = Math.round(usage.firstResultLatencyMs);
  }
  return body;
}

/**
 * Fire and forget. A failed report never surfaces to the Doctor and never
 * affects dictation — accounting is not allowed to interrupt care. `keepalive`
 * lets the report complete even when the Doctor navigates away mid-session.
 */
export function sendVoiceUsageBeacon(usage: VoiceStreamUsage): void {
  const body = voiceUsageBeaconBody(usage);
  if (!body || typeof fetch !== "function") return;
  try {
    void fetch(VOICE_USAGE_ROUTE, {
      method: "POST",
      keepalive: true,
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // Swallowed by design: see above.
  }
}
