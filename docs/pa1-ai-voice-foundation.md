# PA1 / PA1-C1 — AI + Voice Pilot Foundation

Status: **Central accepted PA1 architecture; MD1 PA1-C1 closure candidate.**

This foundation is not wired into Prescription, Investigation or any other live clinical UI. It introduces no database migration and no second clinical-write mechanism.

## Permanent invariant

`AI OUTPUT = PROPOSAL, NOT CLINICAL TRUTH`

Permitted future clinical path:

`Doctor voice → existing DD Deepgram Nova-3 streaming → transient transcript`

or

`Doctor typed text`

then

`text/transcript → PA1 structured proposal parser → strict DD validation → immutable security-binding verification → fresh authoritative context/version check → visible Doctor review → explicit Doctor acceptance → existing DD action/RPC → existing clinical/audit controls`

AI has no database authority, no service-role database client, and no direct finalize/print-confirm/correction/destructive path.

---

## 1. Existing DD voice baseline — REUSED, NOT DUPLICATED

Historical Deepgram evidence audited by MD1:

- original Nova-3 pilot tip: `832b62a7721309968e17256716c0ec0257f0c1e3`
- streaming-v2 implementation anchor: `9d92a60231567911c0dade1b7ab7857a7cd003b3`
- provider-connection audit tip: `993842c50619bbfabf8ed243623df6a791df55df`
- effective audited streaming tree: `4e84a706336d498043402ceaa738fa2828f73068`

The streaming-v2 branch is a direct descendant of the original Nova-3 pilot. The provider-connection audit branch is a direct descendant of streaming-v2 and finishes with zero net application-file difference from the streaming-v2 implementation.

The current M3/PA1 line and historical Loop C voice line have diverged. PA1-C1 therefore performs **selective file/behavior reconciliation only**. A wholesale historical branch merge is prohibited.

### Selectively reconciled onto the current line

- `src/app/api/voice/token/route.ts`
- `src/features/dictation/deepgram-stream.ts`
- `src/features/dictation/provider.ts`
- `src/features/dictation/dictation.ts`
- `src/features/dictation/use-dictation.ts`
- `src/features/dictation/voice-language.tsx`
- `src/features/dictation/components/dictate-button.tsx`
- dedicated Deepgram/dictation regression tests

The historical Browser Web Speech fallback was **not** ported. Deepgram remains the only approved STT provider.

### Voice security boundary

Current selectively reconciled design retains:

- `Deepgram Nova-3`
- browser `MediaRecorder` → Deepgram WebSocket streaming
- one server-only `/api/voice/token` route
- permanent `DEEPGRAM_API_KEY` server-side only
- Deepgram `/v1/auth/grant`
- 30-second temporary access grant
- existing DD `requirePermission("update", "encounter")` session/permission boundary
- same-origin POST requirement
- `Cache-Control: private, no-store`
- Bengali `bn` and English `en-US` only
- interim transcript assembly without duplicate final segments
- 5-second connection timeout
- 5-second first-transcript timeout
- 1.5-second finalization timeout
- one active DD voice lease
- stale-run callback isolation
- exact Discard restoration to pre-run draft/caret
- no patient/encounter/prescription identifier required merely to mint a voice grant
- no raw-audio persistence
- no transcript persistence in the voice transport layer
- no clinical write
- no prescription finalization
- no print confirmation
- no correction start

Permanent rule:

`NO SECOND STT SYSTEM`

PA1 itself contains no `SpeechProvider`, raw-audio API, second MediaRecorder/WebSocket, `/api/voice/transcribe`, or permanent Deepgram credential.

---

## 2. PA1 provider boundary

PA1 owns the structured clinical-proposal boundary only:

`ClinicalProposalParser`: Doctor-authored text or transient DD voice transcript + explicit task type + provider-facing schema → `unknown` provider output.

The unknown output is then independently validated by DD.

The PA1 orchestration accepts exactly one source:

1. typed Doctor text; or
2. a transient transcript supplied by the audited DD Deepgram subsystem.

It accepts no raw audio bytes.

Provider-native structured output is never a DD security or clinical-truth boundary.

---

## 3. PA1-SEC-01 — proposal envelope integrity

PA1-C1 uses a **server-only HMAC-SHA256 integrity-protected, tamper-evident immutable security binding**. No database or server-held proposal table is required.

Signing secret:

`PA1_PROPOSAL_SIGNING_SECRET`

Requirements:

- server-only
- minimum 32 UTF-8 bytes
- never exposed to browser code

The security handle MAC-protects only immutable security context:

- token version
- operation ID
- task type
- source type
- actor user ID
- Doctor profile ID
- practice location ID
- patient ID where applicable
- clinical record ID where applicable
- authoritative expected version
- created timestamp
- expiry timestamp

The HMAC provides integrity/authenticity protection for this binding; it is **not encryption or confidentiality**. The base64url payload can be decoded by a client. Therefore the complete handle must never be logged, rendered visibly in UI, sent to PLATFORM_OWNER analytics, included in client telemetry, or treated as secret ciphertext.

The Doctor-editable proposal body is deliberately **not** signed. Editing medicine/investigation/note content is an intended Doctor action.

### Acceptance rule

A future acceptance endpoint/action must ignore browser-returned envelope binding/timestamps as authority. It must:

1. authenticate the current user;
2. reconstruct current Doctor/person/location authority;
3. re-read the authoritative clinical record;
4. verify the integrity-protected HMAC security handle with timing-safe comparison;
5. compare actor/Doctor/location/patient/record binding;
6. compare authoritative expected version;
7. verify expiry;
8. require explicit visible Doctor acceptance for clinical proposals;
9. validate the edited clinical proposal body with the normal DD contract;
10. invoke only the existing standard DD clinical action/RPC.

The integrity/acceptance layer performs no clinical write itself.

Replay control remains the existing DD version/CAS model: once a successful write advances the authoritative version, an older signed proposal binding becomes stale and fails.

---

## 4. Clinical proposal contracts

### Prescription medicine

Allowed optional/null fields:

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

No UI/default value becomes an AI fact. Missing values remain absent/null.

A missing medicine identity requires explicit ambiguity disclosure.

### Investigation list

Only explicit rows are allowed:

- `name`
- optional/null `note`

No additional investigation may be inferred.

### Clinical note

Transient Doctor-reviewed draft text only.

### Navigation

Only allowlisted non-clinical navigation:

- `OPEN_PATIENT_SEARCH`
- `OPEN_PRESCRIPTION`
- `SHOW_RECENT_MEDICINES`
- `OPEN_INVESTIGATIONS`

Clinical mutation commands are not navigation.

---

## 5. Strict DD validation

Provider result enters DD as `unknown` and is independently validated.

Controls include:

- plain-object requirement
- forbidden prototype-sensitive object keys
- exact allowed fields
- required top-level fields
- strict types
- bounded text lengths
- nullable-vs-missing handling
- bounded uncertainty array
- fixed uncertainty-code allowlist
- exact task-kind match
- `requires_review=true` for clinical proposals
- `additionalProperties=false` provider schema
- allowlisted navigation only

Provider schema compliance does not bypass this validator.

---

## 6. OpenAI Terra synthetic-only parser adapter

Central-selected first parser candidate:

`OpenAI API — gpt-5.6-terra`

PA1-C1 implements an isolated server-only adapter:

`src/features/ai/openai-terra-provider.ts`

Current adapter properties:

- direct Responses API server call
- `model: "gpt-5.6-terra"`
- `store: false`
- low reasoning effort for bounded pilot extraction evaluation
- strict `text.format.type = "json_schema"`
- provider-facing JSON Schema transformed for strict Structured Outputs by making object properties required and representing DD optional clinical values as nullable
- explicit-facts-only system instruction
- no inference from normal clinical practice/defaults
- preserve medicine/test names, units, abbreviations and Bangla/English wording
- ambiguity → null + explicit uncertainty
- prompt-injection-like input treated only as data
- refusal → fail closed
- incomplete response → fail closed
- non-2xx response → fail closed
- malformed/invalid JSON → fail closed
- parsed provider result still returned as `unknown` to DD validator

Synthetic-evaluation factory is gated by both:

- `PA1_SYNTHETIC_AI_EVAL=enabled`
- server-only `OPENAI_API_KEY`

This is **not authorization for real clinical traffic**.

---

## 7. Synthetic semantic evaluation corpus

PA1-C1 contains a fully synthetic, hand-authored 16-case corpus. It contains no real patient, Doctor or clinical-record data.

Coverage includes:

- English prescription extraction
- Bangla prescription extraction
- mixed Bangla-English Bangladesh-style usage
- English medicine names inside Bengali sentence structures
- Bengali medicine wording
- `mg`, `ml`, `mg/5 ml`
- OD / BD / TDS shorthand
- before/after food
- durations
- dose ambiguity
- unit ambiguity
- English/Bangla/mixed investigation lists
- prompt-injection-like quoted text that must not become authority
- no-extra-investigation cases

Hand-authored expected structured outputs are committed alongside the inputs.

Semantic scorer reports independently from JSON validity:

- exact normalized medicine-name extraction
- strength extraction
- dose extraction
- schedule extraction
- duration extraction
- explicit investigation recall
- extra/hallucinated investigation count/rate
- ambiguity disclosure
- mixed-input performance
- per-case semantic failures

Normalization for exact scoring is limited to Unicode NFKC, whitespace collapse and case folding. It does not clinically translate units/abbreviations or convert values.

The scorer's unit tests prove metric correctness against the hand-authored expected fixtures; **that 100% fixture score is not a claim about Terra model accuracy**.

### Current live Terra evaluation status

GitHub Actions currently has no authorized `OPENAI_API_KEY` repository secret available to this branch. The live synthetic job therefore reports:

`BLOCKED_NO_AUTHORIZED_OPENAI_API_KEY`

No live Terra English/Bangla/mixed semantic accuracy percentage may be claimed until that synthetic-only run executes with an authorized key.

---

## 8. Voice and AI privacy

### Voice

Raw audio lifecycle remains:

`microphone → transient browser stream → Deepgram → transcript → release audio`

DD's temporary-token server boundary does not accept clinical audio/transcript.

### Structured parser

Before any **real clinical** parser traffic, Central must separately approve:

1. OpenAI API project/account data-sharing settings;
2. training opt-in/out state;
3. endpoint retention configuration;
4. Zero Data Retention eligibility/status if required;
5. application/provider logging policy;
6. error logging/redaction;
7. provider request-reference handling;
8. clinical-content minimization;
9. contractual/privacy requirements for operating jurisdictions;
10. acceptable synthetic semantic accuracy thresholds.

`store=false` is required by this adapter but is not itself proof of ZDR.

No real clinical traffic is authorized by PA1-C1.

---

## 9. Operational telemetry boundary

PA1 operational telemetry may contain:

- operation ID
- actor/Doctor operational identity
- task type
- timestamps
- provider/model
- outcome
- latency
- accepted/edited/rejected/pending decision
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
- complete security handle or its encoded payload/signature

The complete integrity handle must not be sent to PLATFORM_OWNER analytics or any client telemetry surface.

No durable telemetry table is introduced in PA1-C1.

---

## 10. Threat controls covered by PA1-C1

- malformed provider output rejected
- unexpected fields rejected
- absent fields not silently defaulted
- medicine ambiguity disclosed
- dose/unit ambiguity disclosed by contract/evaluation
- prompt injection treated as input data, not authority
- wrong actor/Doctor/location/patient/record acceptance blocked
- stale clinical version/replay blocked
- browser modification of returned envelope binding cannot alter signed authority
- tampered security handle rejected before clinical context acceptance
- explicit Doctor acceptance required
- voice finalization command rejected
- provider timeout, including non-cooperative adapter, fails closed
- provider refusal/error/incomplete response fails closed
- transcript/raw clinical payload prohibited from operational telemetry
- server/browser secret containment tested
- second STT/provider endpoint prohibited
- one active voice session lease
- stale voice run isolation
- Dictate Discard restores the pre-run draft

---

## 11. Database and integration boundaries

PA1-C1 requires **no Supabase migration**.

No changes are authorized or made to:

- `0041`
- `0042`
- `0043`
- `0044`
- protected Supabase data/schema

Not implemented/wired in PA1-C1:

- Prescription UI integration
- Investigation UI integration
- automatic clinical write adapters
- prescription finalization
- print confirmation
- correction start
- Owner Dashboard persistence/views
- production deployment
- main merge
- real clinical provider traffic

Those remain separate Central gates.
