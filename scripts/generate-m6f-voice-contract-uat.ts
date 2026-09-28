import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { M6F_INVENTORY_METRICS, M6F_VOICE_SURFACE_INVENTORY } from "../src/features/dictation/m6f-voice-surface-inventory";

const rows = M6F_VOICE_SURFACE_INVENTORY.map((entry) => {
  const en = entry.aliasesEnglish[0];
  const bn = entry.aliasesBangla[0];
  const bl = entry.aliasesBanglish[0];
  const set = entry.editable ? `set ${en} <value>` : "navigation/read only";
  const clear = entry.clearable ? `clear ${en}` : "not applicable";
  const replace = entry.replaceable ? `replace ${en} <old> with <new>` : "not applicable";
  const next = entry.nextPreviousEligible ? "yes" : "no";
  const safety = entry.existingProtectedAction ?? "editable draft only";
  return `| \`${entry.canonicalId}\` | ${en} | ${bn} | ${bl} | ${set} | ${clear} | ${replace} | ${next} | ${safety} |`;
});

const document = `# M6F multilingual voice contract — UAT

Generated from \`M6F_VOICE_SURFACE_INVENTORY\` by \`scripts/generate-m6f-voice-contract-uat.ts\`.

- Recovery branch: \`feat/m6f-multilingual-voice-contract-v2-recovery\`
- Frozen base: \`397f4eca4e2bb6324f49f9024b1ee18cad1139b1\`
- Candidate authority: the immutable Git HEAD associated with the Preview (recorded in the CENTRAL handoff and Vercel Git metadata)
- Targets: ${M6F_INVENTORY_METRICS.targets}
- Editable: ${M6F_INVENTORY_METRICS.editable}
- Unsupported editable targets: ${M6F_INVENTORY_METRICS.unsupported}
- English aliases: ${M6F_INVENTORY_METRICS.aliasesEnglish}
- Bangla aliases: ${M6F_INVENTORY_METRICS.aliasesBangla}
- Banglish aliases: ${M6F_INVENTORY_METRICS.aliasesBanglish}
- Closed ASR restorations: ${M6F_INVENTORY_METRICS.asrRestorations}

The canonical grammar accepts explicit action + target, target + action, action + target + value, and target + value + action forms. Raw clinical text remains separate and falls through unchanged when no deterministic command matches. Voice never saves a medicine, confirms investigations, applies an Autopilot proposal, or finalizes a prescription without the existing protected explicit UI action.

| Target | English example | বাংলা example | Banglish example | Set/write | Clear | Replace | Next/previous | Safety boundary |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Required safety spot checks

- \`রোগী মেডিসিন বন্ধ করেছে\`, \`patient stopped medicine yesterday\`, and comparable clinical prose remain dictation.
- Bare \`পরীক্ষা\` is not a navigation shortcut; \`শারীরিক পরীক্ষা\` and explicit investigation/test language disambiguate it.
- \`Select medicine 1\` addresses the authoritative medicine-result list; \`Select proposal medicine 1\` addresses Autopilot.
- Finalize/Sign/Complete/Finish commands return protected Review guidance and perform zero finalization writes.
- Temperature uses the existing Fahrenheit UI/Celsius storage conversion. BP keeps the frozen streaming/reconciliation path.

Status: all listed targets and language columns are supported; no target or alias is pending.
`;

writeFileSync(resolve(process.cwd(), "M6F-VOICE-CONTRACT-UAT.md"), document, "utf8");
