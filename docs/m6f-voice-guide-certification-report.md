# M6F Voice Guide runtime certification report

Baseline audited: `115b137cdb8fa913db9b4e79cfc52294eeb87697`

The pre-correction machine audit passed every advertised language example through command normalization and the real Consultation, Investigation, or Prescription parser. It found **44 failing advertised first examples**. Consultation clinical targets remained intact; the failures were stale or synthetic Prescription examples.

Affected Guide surfaces were:

- Medicines destination (Banglish)
- New/Edit medicine (Bangla)
- Medicine variants and saved medicines
- Signed, Recent, Frequent, Favorites, and My Medicines history/search commands
- Autopilot destination, Generate, proposal Read/Select/Edit/Remove/Discard/Apply, and proposal navigation
- Review (Banglish)

Root causes:

- the inventory generated presentation phrases from UI labels instead of executable runtime aliases;
- several history/search labels omitted the runtime's required signed/show wording;
- medicine-result examples described a list instead of invoking its supported Read/Next/Use actions;
- an ambiguous `medicine` field alias routed to the Medicines destination;
- generated Banglish medicine-field fallbacks such as `strength e` were parsed as values rather than targets;
- exact Bangla staged-investigation wording collided with the staged-title parser branch.

Corrections were limited to certified aliases, bounded normalizations, and the exact staged-list ordering collision. The permanent test now verifies every advertised English, বাংলা, and Banglish alias through normalization, canonical intent/target resolution, and a runtime dispatcher. It also proves that `BP 110/80` remains Examination dictation unless an explicit structured command is used.

Post-correction status: **68 surfaces; 4 VERIFIED; 64 CONTEXTUAL; 0 FAILED; 0 UNSUPPORTED.**
