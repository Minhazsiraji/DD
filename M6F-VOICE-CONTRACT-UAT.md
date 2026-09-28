# M6F multilingual voice contract — UAT

Generated from `M6F_VOICE_SURFACE_INVENTORY` by `scripts/generate-m6f-voice-contract-uat.ts`.

- Recovery branch: `feat/m6f-multilingual-voice-contract-v2-recovery`
- Frozen base: `397f4eca4e2bb6324f49f9024b1ee18cad1139b1`
- Candidate authority: the immutable Git HEAD associated with the Preview (recorded in the CENTRAL handoff and Vercel Git metadata)
- Targets: 68
- Editable: 39
- Unsupported editable targets: 0
- English aliases: 125
- Bangla aliases: 121
- Banglish aliases: 74
- Closed ASR restorations: 62

The canonical grammar accepts explicit action + target, target + action, action + target + value, and target + value + action forms. Raw clinical text remains separate and falls through unchanged when no deterministic command matches. Voice never saves a medicine, confirms investigations, applies an Autopilot proposal, or finalizes a prescription without the existing protected explicit UI action.

| Target | English example | বাংলা example | Banglish example | Set/write | Clear | Replace | Next/previous | Safety boundary |
|---|---|---|---|---|---|---|---|---|
| `consultation.note.chiefComplaints` | chief complaint | প্রধান অভিযোগ | chief complaint e | set chief complaint <value> | clear chief complaint | replace chief complaint <old> with <new> | yes | editable draft only |
| `consultation.note.symptoms` | symptom | উপসর্গ | symptom e | set symptom <value> | clear symptom | replace symptom <old> with <new> | yes | editable draft only |
| `consultation.note.presentIllness` | history | বর্তমান অসুস্থতার ইতিহাস | history te | set history <value> | clear history | replace history <old> with <new> | yes | editable draft only |
| `consultation.note.pastHistory` | past history | অতীত ইতিহাস | past history te | set past history <value> | clear past history | replace past history <old> with <new> | yes | editable draft only |
| `consultation.note.examination` | examination | শারীরিক পরীক্ষা | examination e | set examination <value> | clear examination | replace examination <old> with <new> | yes | editable draft only |
| `consultation.note.assessment` | assessment | মূল্যায়ন | assessment e | set assessment <value> | clear assessment | replace assessment <old> with <new> | yes | editable draft only |
| `consultation.note.advice` | advice | পরামর্শ | advice e | set advice <value> | clear advice | replace advice <old> with <new> | yes | editable draft only |
| `consultation.followUp.section` | follow-up | ফলো আপ | follow up e | navigation/read only | not applicable | not applicable | no | editable draft only |
| `consultation.followUp.date` | follow-up date | ফলো আপ তারিখ | follow up date e | set follow-up date <value> | clear follow-up date | replace follow-up date <old> with <new> | no | editable draft only |
| `consultation.followUp.note` | follow-up note | ফলো আপ নোট | follow up note e | set follow-up note <value> | clear follow-up note | replace follow-up note <old> with <new> | yes | editable draft only |
| `consultation.vitals.section` | vitals | ভাইটালস | vitals e | navigation/read only | not applicable | not applicable | no | editable draft only |
| `consultation.vitals.bloodPressure` | blood pressure | রক্তচাপ | bp te | navigation/read only | not applicable | not applicable | yes | editable draft only |
| `consultation.vital.vitalHeightCm` | height | উচ্চতা | height e | set height <value> | clear height | replace height <old> with <new> | yes | editable draft only |
| `consultation.vital.vitalWeightKg` | weight | ওজন | weight e | set weight <value> | clear weight | replace weight <old> with <new> | yes | editable draft only |
| `consultation.vital.vitalTemperatureC` | temperature | তাপমাত্রা | temperature e | set temperature <value> | clear temperature | replace temperature <old> with <new> | yes | editable draft only |
| `consultation.vital.vitalPulseBpm` | pulse | পালস | pulse e | set pulse <value> | clear pulse | replace pulse <old> with <new> | yes | editable draft only |
| `consultation.vital.vitalSystolic` | systolic | সিস্টোলিক | systolic e | set systolic <value> | clear systolic | replace systolic <old> with <new> | no | editable draft only |
| `consultation.vital.vitalDiastolic` | diastolic | ডায়াস্টোলিক | diastolic e | set diastolic <value> | clear diastolic | replace diastolic <old> with <new> | no | editable draft only |
| `consultation.vital.vitalRespRate` | respiratory rate | শ্বাসের হার | respiratory rate e | set respiratory rate <value> | clear respiratory rate | replace respiratory rate <old> with <new> | yes | editable draft only |
| `consultation.vital.vitalSpo2` | spo2 | অক্সিজেন স্যাচুরেশন | spo2 te | set spo2 <value> | clear spo2 | replace spo2 <old> with <new> | yes | editable draft only |
| `consultation.vitals.more` | more vitals | আরও ভাইটালস | more vitals kholo | navigation/read only | not applicable | not applicable | no | editable draft only |
| `consultation.diagnosis.section` | diagnosis | রোগ নির্ণয় | diagnosis e | navigation/read only | not applicable | not applicable | no | Add diagnosis |
| `consultation.diagnosis.title` | diagnosis title | রোগ নির্ণয়ের নাম | diagnosis title e | set diagnosis title <value> | clear diagnosis title | replace diagnosis title <old> with <new> | yes | Add diagnosis |
| `consultation.diagnosis.certainty` | diagnosis certainty | নিশ্চিততা | certainty te | set diagnosis certainty <value> | not applicable | replace diagnosis certainty <old> with <new> | yes | Add diagnosis |
| `consultation.diagnosis.note` | diagnosis note | ডায়াগনসিস নোট | diagnosis note e | set diagnosis note <value> | clear diagnosis note | replace diagnosis note <old> with <new> | yes | Add diagnosis |
| `consultation.investigation.section` | investigation | ইনভেস্টিগেশন | investigation e | navigation/read only | not applicable | not applicable | no | Confirm investigations |
| `consultation.investigation.search` | investigation search | ইনভেস্টিগেশন সার্চ | investigation search e | set investigation search <value> | clear investigation search | replace investigation search <old> with <new> | no | stage result explicitly |
| `consultation.investigation.stagedList` | staged investigations | স্টেজড ইনভেস্টিগেশন | staged investigation list | navigation/read only | not applicable | not applicable | yes | Confirm investigations |
| `consultation.investigation.stagedTitle` | staged investigation title | স্টেজড পরীক্ষার নাম | staged investigation title e | set staged investigation title <value> | clear staged investigation title | replace staged investigation title <old> with <new> | no | Confirm investigations |
| `consultation.investigation.stagedNote` | staged investigation note | স্টেজড পরীক্ষার নোট | staged investigation note e | set staged investigation note <value> | clear staged investigation note | replace staged investigation note <old> with <new> | no | Confirm investigations |
| `consultation.investigation.confirmedTitle` | confirmed investigation title | নিশ্চিত পরীক্ষার নাম | confirmed investigation title e | set confirmed investigation title <value> | clear confirmed investigation title | replace confirmed investigation title <old> with <new> | no | Save correction |
| `consultation.investigation.confirmedNote` | confirmed investigation note | নিশ্চিত পরীক্ষার নোট | confirmed investigation note e | set confirmed investigation note <value> | clear confirmed investigation note | replace confirmed investigation note <old> with <new> | no | Save correction |
| `consultation.investigation.confirm` | confirm investigations | পরীক্ষা নিশ্চিত করো | investigation confirm koro | navigation/read only | not applicable | not applicable | no | visible Confirm investigations button |
| `consultation.prescription.open` | write prescription | প্রেসক্রিপশন খোলো | prescription kholo | navigation/read only | not applicable | not applicable | no | opens draft only |
| `prescription.medicines.section` | medicines | ওষুধ | medicine list e | navigation/read only | not applicable | not applicable | yes | saved list only |
| `prescription.medicine.form` | new medicine | নতুন ওষুধ | medicine add koro | navigation/read only | not applicable | not applicable | no | visible Add medicine or Save changes |
| `prescription.medicine.displayName` | medicine name | ওষুধের নাম | medicine nam | set medicine name <value> | clear medicine name | replace medicine name <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.brandName` | brand | ব্র্যান্ড | brand nam | set brand <value> | clear brand | replace brand <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.genericName` | generic | জেনেরিক | generic nam | set generic <value> | clear generic | replace generic <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.strengthText` | strength | স্ট্রেংথ | strength e | set strength <value> | clear strength | replace strength <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.doseText` | dose | ডোজ | dose e | set dose <value> | clear dose | replace dose <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.dosageForm` | dosage form | ডোজ ফর্ম | form e | set dosage form <value> | clear dosage form | replace dosage form <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.route` | route | রুট | route e | set route <value> | clear route | replace route <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.scheduleText` | schedule | সিডিউল | schedule e | set schedule <value> | clear schedule | replace schedule <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.durationText` | duration | ডিউরেশন | duration e | set duration <value> | clear duration | replace duration <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.quantityText` | quantity | পরিমাণ | quantity e | set quantity <value> | clear quantity | replace quantity <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.foodRelation` | food relation | খাবার | with food e | set food relation <value> | clear food relation | replace food relation <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.instructions` | instructions | ইনস্ট্রাকশন | instructions for the patient e | set instructions <value> | clear instructions | replace instructions <old> with <new> | yes | visible Add medicine or Save changes |
| `prescription.medicine.prn` | PRN | প্রয়োজনে | proyojone | set PRN <value> | clear PRN | replace PRN <old> with <new> | yes | draft toggle only |
| `prescription.medicine.substitution` | substitution allowed | বিকল্প ব্র্যান্ড চলবে | substitution allow koro | set substitution allowed <value> | clear substitution allowed | replace substitution allowed <old> with <new> | yes | draft toggle only |
| `prescription.results` | medicine variants | মেডিসিন ভ্যারিয়েন্ট | variant gulo | navigation/read only | not applicable | not applicable | yes | selection stages draft only |
| `prescription.saved` | saved medicines | সেভ করা ওষুধ | saved medicine list | navigation/read only | not applicable | not applicable | yes | remove requires confirmation |
| `prescription.history.signed` | signed medicine history | সাইনড মেডিসিন হিস্ট্রি | signed medicine history kholo | navigation/read only | not applicable | not applicable | yes | selection stages only |
| `prescription.history.reuse` | reuse previous prescription | আগের প্রেসক্রিপশন ব্যবহার করো | previous prescription reuse koro | navigation/read only | not applicable | not applicable | no | reuse remains guarded |
| `prescription.history.recent` | recent medicines | সাম্প্রতিক ওষুধ | recent medicine kholo | navigation/read only | not applicable | not applicable | no | history view only |
| `prescription.history.frequent` | frequent medicines | বেশি ব্যবহৃত ওষুধ | frequent medicine kholo | navigation/read only | not applicable | not applicable | no | history view only |
| `prescription.history.favorites` | favorite medicines | পছন্দের ওষুধ | favorite medicine kholo | navigation/read only | not applicable | not applicable | no | selection stages only |
| `prescription.history.mine` | my medicines | আমার ওষুধ | my medicine kholo | navigation/read only | not applicable | not applicable | no | selection stages only |
| `prescription.autopilot.destination` | autopilot | অটোপাইলট Autopilot | autopilot destination koro | navigation/read only | not applicable | not applicable | no | explicit Apply selected |
| `prescription.autopilot.generate` | generate | অটোপাইলট Generate | autopilot generate koro | navigation/read only | not applicable | not applicable | no | proposal only |
| `prescription.autopilot.proposal` | autopilot proposal | অটোপাইলট Autopilot proposal | autopilot proposal koro | navigation/read only | not applicable | not applicable | yes | proposal only |
| `prescription.autopilot.select` | select proposal medicine | অটোপাইলট Select proposal medicine | autopilot select koro | navigation/read only | not applicable | not applicable | no | selection only |
| `prescription.autopilot.edit` | edit proposal medicine | অটোপাইলট Edit proposal medicine | autopilot edit koro | navigation/read only | not applicable | not applicable | no | proposal only |
| `prescription.autopilot.remove` | remove proposal medicine | অটোপাইলট Remove proposal medicine | autopilot remove koro | navigation/read only | not applicable | not applicable | no | proposal only |
| `prescription.autopilot.discard` | discard proposal | অটোপাইলট Discard proposal | autopilot discard koro | navigation/read only | not applicable | not applicable | no | discard only |
| `prescription.autopilot.apply` | apply selected | অটোপাইলট Apply selected | autopilot apply koro | navigation/read only | not applicable | not applicable | no | explicit Apply selected |
| `prescription.autopilot.navigation` | next/previous proposal | অটোপাইলট Next/Previous proposal | autopilot navigation koro | navigation/read only | not applicable | not applicable | yes | proposal only |
| `prescription.review` | review prescription | প্রেসক্রিপশন রিভিউ | prescription review koro | navigation/read only | not applicable | not applicable | no | voice finalization prohibited |

## Required safety spot checks

- `রোগী মেডিসিন বন্ধ করেছে`, `patient stopped medicine yesterday`, and comparable clinical prose remain dictation.
- Bare `পরীক্ষা` is not a navigation shortcut; `শারীরিক পরীক্ষা` and explicit investigation/test language disambiguate it.
- `Select medicine 1` addresses the authoritative medicine-result list; `Select proposal medicine 1` addresses Autopilot.
- Finalize/Sign/Complete/Finish commands return protected Review guidance and perform zero finalization writes.
- Temperature uses the existing Fahrenheit UI/Celsius storage conversion. BP keeps the frozen streaming/reconciliation path.

Status: all listed targets and language columns are supported; no target or alias is pending.
