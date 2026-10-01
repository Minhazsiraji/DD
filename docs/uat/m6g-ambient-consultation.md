# M6G Ambient Consultation — Synthetic UAT Pack

All cases are synthetic. No real patient data. In every case, low-risk documentation may enter editable consultation drafts, while diagnosis, investigation orders, medicines/dose/frequency/duration, and finalization must remain Doctor-reviewed through the existing protected workflow.

## 1. Bangla acute case
**Synthetic patient:** UAT-BN-01, adult.  
**Spoken script:** “রোগীর তিন দিন ধরে জ্বর, কাশি আর দুর্বলতা। পরীক্ষায় হালকা wheeze আছে। CBC করতে হবে। তিন দিন পর follow-up.”  
**Expected routing:** complaints/HPI = fever/cough/weakness and 3 days; examination = mild wheeze; investigation proposal = CBC; follow-up = 3 days.  
**Expected structured fields:** chief complaint/HPI, examination, follow-up.  
**High-risk proposals:** CBC.  
**Doctor confirmations:** CBC via existing investigation review/confirm.  
**Must NOT auto-finalize:** CBC, diagnosis, encounter, final prescription.  
**Pass/fail:** Bangla retained; CBC not confirmed by speech; no silent diagnosis/finalize.

## 2. English acute case
**Synthetic patient:** UAT-EN-02, adult.  
**Spoken script:** “Patient has fever for three days and vomiting twice. Pain radiates to the back. On examination mild epigastric tenderness. Assessment suggests acute pancreatitis. Add CBC, serum amylase and lipase. Follow-up after 3 days.”  
**Expected routing:** HPI = fever 3 days, vomiting twice, radiation to back; examination = epigastric tenderness; diagnosis proposal = acute pancreatitis; investigation proposals = CBC/amylase/lipase; follow-up = 3 days.  
**Expected structured fields:** HPI, examination, follow-up.  
**High-risk proposals:** acute pancreatitis, CBC, serum amylase, lipase.  
**Doctor confirmations:** diagnosis plus investigations through existing protected workflows.  
**Must NOT auto-finalize:** diagnosis, investigations, prescription/finalize.  
**Pass/fail:** pancreas/pancreatitis terminology preserved; consequential items remain proposals.

## 3. Banglish acute case
**Synthetic patient:** UAT-MIX-03, adult.  
**Spoken script:** “Patient-er 3 din dhore fever, upper abdominal pain ache, vomiting dui bar hoyeche. Pain ta back-e radiate kore. Examination-e mild epigastric tenderness ache. CBC, serum amylase, lipase korte hobe. Follow-up 3 din por.”  
**Expected routing:** HPI, examination, investigation proposals, follow-up.  
**Expected structured fields:** preserve Patient, fever, upper abdominal pain, vomiting, back, CBC, serum amylase, lipase.  
**High-risk proposals:** CBC/amylase/lipase.  
**Doctor confirmations:** investigations only after explicit visible confirmation.  
**Must NOT auto-finalize:** investigations, diagnosis, finalize.  
**Pass/fail:** mixed Bangla/English survives normalization without translated medicine/test names.

## 4. Diabetes follow-up
**Synthetic patient:** UAT-DM-04, adult.  
**Spoken script:** “Known diabetes for five years. Fasting glucose has been high. Check HbA1c. Continue metformin 500 mg twice daily. Review after one month.”  
**Expected routing:** past history = diabetes 5 years; HPI = glucose context; investigation proposal = HbA1c; medicine proposal = metformin 500 mg twice daily; follow-up = one month.  
**Expected structured fields:** history and follow-up.  
**High-risk proposals:** HbA1c and metformin dose/frequency.  
**Doctor confirmations:** investigation and medicine through existing protected flows.  
**Must NOT auto-finalize:** HbA1c order, metformin, dose/frequency, prescription.  
**Pass/fail:** HbA1c preserved; medicine never silently applied.

## 5. Hypertension follow-up
**Synthetic patient:** UAT-HTN-05, adult.  
**Spoken script:** “History of hypertension. Headache is better. On examination no edema. Start amlodipine 5 mg daily. Follow-up after 14 days.”  
**Expected routing:** past history, HPI, examination, medicine proposal, follow-up.  
**Expected structured fields:** history/HPI/examination/follow-up.  
**High-risk proposals:** amlodipine 5 mg daily.  
**Doctor confirmations:** prescription review.  
**Must NOT auto-finalize:** medicine and final prescription.  
**Pass/fail:** dose/frequency remains a proposal.

## 6. Respiratory case
**Synthetic patient:** UAT-RESP-06, adult.  
**Spoken script:** “Patient has cough and shortness of breath for two days. On examination bilateral wheeze. Order chest X-ray. Advise hydration and rest.”  
**Expected routing:** HPI, examination, investigation proposal, advice.  
**Expected structured fields:** complaints/HPI/examination/advice.  
**High-risk proposals:** chest X-ray.  
**Doctor confirmations:** investigation.  
**Must NOT auto-finalize:** X-ray order or diagnosis.  
**Pass/fail:** wheeze goes to examination; advice remains editable note.

## 7. GI / abdominal case
**Synthetic patient:** UAT-GI-07, adult.  
**Spoken script:** “Upper abdominal pain since yesterday with vomiting. Pain radiates to the back. On examination epigastric tenderness. Assessment suggests pancreatic inflammation. Add serum amylase and lipase.”  
**Expected routing:** HPI, examination, diagnosis/assessment proposal, investigation proposals.  
**Expected structured fields:** HPI and examination.  
**High-risk proposals:** pancreatic assessment, amylase, lipase.  
**Doctor confirmations:** diagnosis and investigations.  
**Must NOT auto-finalize:** pancreatic diagnosis/tests.  
**Pass/fail:** pancreatic terminology preserved; no autonomous diagnosis.

## 8. Pediatric synthetic case
**Synthetic patient:** UAT-PED-08, child, fully synthetic.  
**Spoken script:** “Child has fever and cough for two days. Drinking less but alert. On examination mild wheeze. Check CBC. Follow-up tomorrow.”  
**Expected routing:** complaints/HPI, examination, CBC proposal, follow-up.  
**Expected structured fields:** symptoms/HPI/examination/follow-up.  
**High-risk proposals:** CBC.  
**Doctor confirmations:** investigation.  
**Must NOT auto-finalize:** CBC, diagnosis, medicine.  
**Pass/fail:** no real patient identifier; pediatric context does not weaken confirmation boundary.

## 9. Complex multi-section consultation
**Synthetic patient:** UAT-CPLX-09, adult.  
**Spoken script:** “Patient has fever and upper abdominal pain for three days, vomiting twice. History of diabetes. On examination mild epigastric tenderness. Assessment suggests acute pancreatitis. Add CBC, HbA1c, serum amylase and lipase. Start paracetamol 500 mg as needed. Advise fluids. Follow-up after 3 days.”  
**Expected routing:** HPI, past history, examination, assessment proposal, investigation proposals, medicine proposal, advice, follow-up.  
**Expected structured fields:** low-risk note sections only.  
**High-risk proposals:** acute pancreatitis; CBC/HbA1c/amylase/lipase; paracetamol 500 mg/prn.  
**Doctor confirmations:** diagnosis, investigations, medicine.  
**Must NOT auto-finalize:** all high-risk content and encounter/prescription finalization.  
**Pass/fail:** patient/fever/pancreas-related diagnosis/CBC/HbA1c/medicine/follow-up are represented without duplicate auto-finalization.

## 10. Correction-heavy consultation
**Synthetic patient:** UAT-CORR-10, adult.  
**Spoken script:** “Patient has fever and vomiting. Correction, not fever, actually chills. Remove vomiting. Add another symptom, headache. Follow-up after 3 days. Change follow-up to 7 days. Previous sentence was wrong.”  
**Expected routing:** initial low-risk notes; matched replacement fever → chills; removal of vomiting when safely matched; unmatched/ambiguous corrections go to Needs review; follow-up revision requires Doctor review if deterministic matching is not safe.  
**Expected structured fields:** corrected complaint/HPI and follow-up only after safe edit/review.  
**High-risk proposals:** none unless later speech adds one.  
**Doctor confirmations:** uncertain/conflicting corrections resolved by Doctor in review panel.  
**Must NOT auto-finalize:** ambiguous correction or final encounter.  
**Pass/fail:** no duplicate fever/vomiting statement remains after accepted corrections; ambiguous “previous sentence” is not guessed silently.

## Global UAT pass gates
- Start Ambient → Listening → Pause → Resume → Stop & Review work.
- Live transcript/current status is visible without cluttering the consultation.
- Deterministic low-risk routing is editable and uses existing consultation drafts/autosave.
- Uncertain routing goes to Needs review; no fake numeric confidence is shown.
- Diagnosis/investigation/medicine proposals never become authoritative without existing Doctor confirmation.
- Spoken finalize/sign/complete does not finalize anything.
- Duplicate equivalent statements are suppressed.
- Bangla, English and Banglish terms/numbers/units are preserved.
- M6G audit metadata contains event/target/ids only, not clinical transcript content.
- No raw audio is persisted by M6G.
- Existing Voice Guide, prescription, investigations, diagnosis and Documents behavior remain functional.
