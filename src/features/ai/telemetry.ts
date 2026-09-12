import "server-only";

/**
 * AI / Voice usage telemetry — the persisted L0 event contract (O1-E-R3).
 *
 * THE ALLOWLIST IS THE SCHEMA. An event is persisted only if every key appears
 * below for its event type, every allowed key is present, and every value has
 * the declared shape. There is no free-form `meta`, no JSON bag, and no field
 * whose content is decided at call time — so "unknown fields fail" is
 * structural, not a rule someone has to remember.
 *
 * NEVER HERE, IN ANY FORM: patient, encounter, prescription, document or
 * appointment identifiers, or any hash, HMAC, digest or other derivative of
 * one; the proposal security handle; prompt, completion, authored text or
 * transcript; audio content; proposal clinical content (medicine, test,
 * diagnosis, note); provider raw request or response. None of them has a key,
 * and no allowed field is free text that could smuggle one in.
 *
 * TELEMETRY IDS ARE MINTED, NEVER COPIED. Every correlation id carries a
 * namespace prefix (`ddop_`, `ddprop_`, `ddvs_`, `ddgr_`) and must come from a
 * mint function. A bare UUID copied from a clinical row can never pass as one.
 */

export * from "./telemetry-events";
export * from "./telemetry-allowlist";
export * from "./telemetry-validation";
export * from "./telemetry-privacy";
export * from "./telemetry-builders";
export * from "./telemetry-voice";
