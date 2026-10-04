# M6H Ambient Clinical Draft — Synthetic UAT

Synthetic data only. M6H is a review/apply layer over M6G and the existing DD consultation/prescription authority.

## Global safety contract
- Ready to apply: low-risk documentation only.
- Doctor confirmation required: diagnosis, investigations, medicines/dose/frequency/duration.
- Needs review: ambiguous, conflicting, unmatched correction, unsupported/finalize/sign requests.
- Apply approved draft writes only accepted low-risk documentation.
- Apply never signs, finalizes, completes an encounter, confirms an investigation, creates a diagnosis, or signs a medicine order.
- No raw audio persistence and no transcript/clinical text in audit metadata.

## Banglish acute case
Input: `Patient-er 3 din dhore fever, upper abdominal pain ache, vomiting dui bar hoyeche. Pain ta back-e radiate kore. Examination-e mild epigastric tenderness ache. CBC, serum amylase, lipase korte hobe. Follow-up 3 din por.`
Expected Ready: HPI/examination/follow-up documentation with numbers and mixed-language clinical terms preserved.
Expected confirmation: CBC, serum amylase, lipase.
Expected Needs review: none when routing is deterministic.
After Apply: safe documentation enters existing editable drafts; investigations remain pending authoritative confirmation.

## Diabetes follow-up
Input: `Known diabetes for five years. Fasting glucose has been high. Check HbA1c. Continue metformin 500 mg twice daily. Review after one month.`
Expected Ready: history/HPI/follow-up.
Expected confirmation: HbA1c and metformin 500 mg twice daily.
After Apply: safe notes only; medicine and investigation still require existing protected workflows.

## Abdominal / pancreatic case
Input: `Upper abdominal pain since yesterday with vomiting. Pain radiates to the back. On examination epigastric tenderness. Assessment suggests pancreatic inflammation. Add serum amylase and lipase.`
Expected Ready: HPI and examination.
Expected confirmation: pancreatic assessment, amylase, lipase.
After Apply: no autonomous diagnosis or investigation order.

## Complex multi-section case
Input: reuse M6G UAT-CPLX-09.
Expected Ready: HPI, past history, examination, advice, follow-up.
Expected confirmation: diagnosis, CBC/HbA1c/amylase/lipase, paracetamol proposal.
After Apply: all protected proposals remain outside one-click documentation apply.

## Correction-heavy case
Input: reuse M6G UAT-CORR-10.
Expected Ready: initial deterministic documentation only.
Expected Needs review: changes to existing Doctor-entered text and ambiguous `Previous sentence was wrong`.
Expected diff: existing content remains visible/authoritative until Doctor resolves the proposed correction.
After Apply: only accepted safe documentation is applied; unresolved correction remains unfinished.

## Completion-state check
After Apply approved draft, verify the UI status reports:
- number of safe documentation items applied;
- protected proposals still waiting;
- ambiguous items still needing review.

Responsive checks: 1440px, 768px, 360px. The action bar remains usable without creating a separate AI dashboard.
