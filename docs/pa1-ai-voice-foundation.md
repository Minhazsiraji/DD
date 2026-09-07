# PA1 — AI + Voice Pilot Foundation

Status: MD1 isolated foundation for Central review. Not wired into CSU or any live clinical UI.

## Permanent invariant

`AI OUTPUT = PROPOSAL, NOT CLINICAL TRUTH`

The only permitted clinical path is:

`Doctor voice/text → DD transcript/text → typed proposal → strict server validation → visible Doctor review/acceptance → existing DD action/RPC → existing clinical/audit controls`

AI has no database authority, no service-role database client, and no direct finalize/print-confirm/destructive path.

## Existing DD voice baseline — REUSE, DO NOT DUPLICATE

Doctor's Diary already has an audited Deepgram Nova-3 streaming implementation in the historical Loop C voice lane.

Canonical evidence:

- original Nova-3 pilot branch tip: `832b62a7721309968e17256716c0ec0257f0c1e3`
- streaming-v2 implementation anchor: `9d92a60231567911c0dade1b7ab7857a7cd003b3`
- latest provider-connection audit tip: `993842c50619bbfabf8ed243623df6a791df55df`
- streaming-v2 and provider-connection audit tips resolve to the same final code tree: `4e84a706336d498043402ceaa738fa2828f73068`

The streaming-v2 branch is a direct descendant of the original Nova-3 pilot. The provider-connection audit branch is a direct descendant of streaming-v2 and ends with the same code tree after temporary CI/provider gates were removed.

The audited implementation uses:

- `Deepgram Nova-3`
- browser `MediaRecorder` → direct Deepgram WebSocket streaming
- server-only `/api/voice/token` grant boundary
- permanent `DEEPGRAM_API_KEY` kept server-side
- short-lived 30-second access grants
- authenticated Doctor permission check before grant
- same-origin request enforcement
- Bangla `bn` and English `en-US` allowlist
- interim streaming results and cumulative transcript assembly
- bounded connection, first-transcript and finalization timeouts
- stale-run isolation, single live voice lease and exact Discard restoration
- no raw audio or transcript persistence/logging in the audited voice path
- no clinical write/finalize authority in the voice transport.

PA1 therefore MUST NOT create another STT provider, batch-audio endpoint, raw-audio orchestration API, or second Deepgram credential path.

The current M3/PA1 line and historical Loop C Deepgram line have diverged. Future integration must selectively port/reconcile the audited voice subsystem onto the current accepted line under a separate Central gate. A wholesale historical-branch merge is not approved by PA1.

## PA1 provider boundary

PA1 owns only the structured clinical proposal boundary:

`ClinicalProposalParser`: Doctor-authored text or a transient DD voice transcript + explicit task type + strict JSON schema → unknown provider output, which DD validates independently.

The PA1 server orchestration accepts either:

1. typed Doctor text; or
2. a transient transcript supplied by DD's existing audited voice subsystem, with privacy-safe provider/language/usage metadata.

It accepts **no raw audio bytes** and contains **no SpeechProvider/STT transport**.

A parser response is never trusted merely because the provider claims schema conformance.

### Parser provider decision

The structured proposal parser remains provider-neutral in PA1. Central must separately approve the live parser/provider/account configuration before any real clinical payload is sent externally.

No GPT-Transcribe integration is proposed because DD already has the reusable Deepgram Nova-3 STT subsystem.

## Language

Pilot input may be English, Bangla, or mixed Bangla-English medical language.

Rules:

- Do not translate medicine or test names merely for stylistic consistency.
- Preserve medically significant units and wording.
- Missing speech stays missing/null.
- Ambiguity becomes an explicit uncertainty requiring Doctor review.
- Never normalize a unit into a different clinical value.

## Proposal contracts

### Prescription medicine

Optional/null proposal fields mirror the M3 medicine surface:

- `display_name`
- `brand_name`
- `generic_name`
- `strength_text`
- `dose_text`
- `dosage_form`
- `route`
- `schedule_text`
- `duration_text`
- `quantity_text`
- `food_relation`
- `is_prn`
- `instructions`
- `substitution_allowed`

No UI default is treated as an AI fact. In particular, absent booleans remain absent rather than inheriting composer defaults.

### Investigation list

Only explicit rows are allowed:

- `name`
- optional/null `note`

No additional investigation may be inferred.

### Navigation

Only an allowlist can be direct navigation:

- `OPEN_PATIENT_SEARCH`
- `OPEN_PRESCRIPTION`
- `SHOW_RECENT_MEDICINES`
- `OPEN_INVESTIGATIONS`

Clinical mutations are not navigation commands.

## Authorization and replay boundary

Each clinical proposal is server-bound to:

- actor user
- Doctor profile
- practice location
- patient where applicable
- clinical record where applicable
- authoritative expected record version
- creation/expiry time

Before acceptance integration, the server must reconstruct current authority from the verified session and authoritative record, compare every binding field, require visible Doctor acceptance, then call the existing DD action/RPC.

The existing DD version/CAS model is the replay/duplicate-accept control: after the first successful clinical write advances the record, a replay bound to the old version must fail. PA1 therefore does not introduce a new clinical write path or database idempotency table.

## Voice privacy

Raw audio lifecycle belongs exclusively to the existing audited DD voice subsystem:

`microphone → transient Deepgram stream → transcript → release audio`

PA1 begins **after transcription** and receives no raw audio. Proposal envelopes and owner telemetry contain neither raw audio nor transcript text.

Permanent audio storage requires a separate Central decision.

## Audit and telemetry

Clinical content and operational analytics are separate.

PA1 operational telemetry may contain:

- operation id
- actor/Doctor operational identity
- task type
- timestamps
- provider/model
- success/failure
- latency
- accepted/edited/rejected/pending
- audio seconds when supplied by the audited voice subsystem
- input/output token counts
- estimated provider cost

It must not contain:

- patient identity
- transcript
- prompt
- raw audio
- medicine/test content
- clinical note content
- proposal payload

Platform Owner receives aggregate business/cost information only.

## Threat controls

PA1 foundation explicitly fails closed against:

- malformed/extra provider fields;
- hallucinated or absent clinical facts being silently defaulted;
- ambiguous medicine/dose without explicit uncertainty/review;
- prompt-injection-like transcript text becoming authority;
- wrong-patient/Doctor/location/record binding;
- stale clinical version/replayed acceptance;
- clinical mutation without explicit Doctor acceptance;
- voice navigation attempting finalization;
- parser timeout, including a non-cooperative provider adapter;
- transcript/raw clinical content entering operational telemetry;
- service-role or browser-exposed provider secrets;
- a second raw-audio/STT transport being introduced inside PA1.

## Pre-real-clinical provider gate

Before any real clinical payload is sent to a live structured-proposal provider, Central must verify at minimum:

1. chosen provider account/project retention settings;
2. training/data-sharing settings;
3. whether the selected endpoint is eligible for the required retention mode;
4. API keys are server-only and absent from browser bundles;
5. vendor contractual/privacy requirements for DD's operating jurisdictions;
6. synthetic Bangla-English clinician-like accuracy evaluation, especially medicine names, units and abbreviations;
7. timeout/failure UI preserves Doctor text and performs no clinical write;
8. the audited Deepgram subsystem is selectively reconciled with the current M3/PA1 line without reintroducing historical unrelated changes.

## Supabase requirement

PA1 foundation requires **no new Supabase migration**.

If Central later wants durable AI operation telemetry, the persistence shape must be reviewed separately before a protected migration is created. The current PA1 types are intentionally persistence-neutral.

## Integration boundary

Not implemented in PA1:

- live structured-proposal provider adapter/secrets;
- selective port/reconciliation of the historical Deepgram subsystem onto the current M3/PA1 line;
- Prescription UI wiring;
- Investigation UI wiring;
- clinical action adapters;
- finalization;
- print confirmation;
- Owner Dashboard persistence/views;
- production deployment.

Those remain separate Central gates.
