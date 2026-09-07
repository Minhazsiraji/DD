# PA1 — AI + Voice Pilot Foundation

Status: MD1 isolated foundation for Central review. Not wired into CSU or any live clinical UI.

## Permanent invariant

`AI OUTPUT = PROPOSAL, NOT CLINICAL TRUTH`

The only permitted clinical path is:

`Doctor voice/text → transient transcription when needed → typed proposal → strict server validation → visible Doctor review/acceptance → existing DD action/RPC → existing clinical/audit controls`

AI has no database authority, no service-role database client, and no direct finalize/print-confirm/destructive path.

## Provider boundary

PA1 separates two providers:

1. `SpeechProvider`: transient audio → transcript + language/confidence when available + privacy-safe request/usage metadata.
2. `ClinicalProposalParser`: Doctor-authored text/transcript + explicit task type + strict JSON schema → unknown provider output, which DD validates independently.

A provider response is never trusted merely because the provider claims schema conformance.

### Pilot recommendation

For the first synthetic/pilot integration evaluation:

- STT default candidate: OpenAI GPT-Transcribe for push-to-talk/committed utterances.
- Structured proposal parser candidate: OpenAI GPT-5.6 Terra through Responses structured outputs with strict JSON Schema and `store=false`.
- Cost-optimization candidate after DD-specific evaluation: GPT-5.6 Luna.
- STT alternatives retained behind the same interface: Deepgram Nova-3 and Google Speech-to-Text V2.

The provider choice is not a clinical invariant. Provider replacement must not require changes to Prescription or Investigation contracts.

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

Raw audio lifecycle is transient only:

`microphone → in-memory/transient provider input → transcript → proposal → release audio`

PA1 accepts audio bytes, not a storage path. Proposal envelopes and owner telemetry contain neither raw audio nor transcript text.

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
- audio seconds
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

## Pre-real-clinical provider gate

Before any real clinical payload is sent to a live AI/STT provider, Central must verify at minimum:

1. chosen provider account/project retention settings;
2. training/data-sharing settings;
3. whether the selected endpoint is eligible for the required retention mode;
4. API keys are server-only and absent from browser bundles;
5. vendor contractual/privacy requirements for DD's operating jurisdictions;
6. synthetic Bangla-English clinician-like accuracy evaluation, especially medicine names, units and abbreviations;
7. timeout/failure UI preserves Doctor text and performs no clinical write.

`store=false` is required for a Responses-based parser but is not, by itself, proof of Zero Data Retention. Account-level eligibility/settings must be verified separately.

## Supabase requirement

PA1 foundation requires **no new Supabase migration**.

If Central later wants durable AI operation telemetry, the persistence shape must be reviewed separately before a protected migration is created. The current PA1 types are intentionally persistence-neutral.

## Integration boundary

Not implemented in PA1:

- live provider adapters/secrets;
- Prescription UI wiring;
- Investigation UI wiring;
- clinical action adapters;
- finalization;
- print confirmation;
- Owner Dashboard persistence/views;
- production deployment.

Those remain separate Central gates.
