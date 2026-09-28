import { describe, expect, it } from "vitest";
import { M6F_VOICE_SURFACE_INVENTORY } from "./m6f-voice-surface-inventory";
import { M6F_CLOSED_ASR_RESTORATIONS, m6fActionAliases, normalizeM6FCommandText, parseM6FAction, type M6FAction } from "./m6f-action-grammar";

const actionFor = (editable: boolean, readable: boolean, clearable: boolean): M6FAction[] => [
  "NAVIGATE", "OPEN", "SHOW", ...(readable ? ["READ" as const] : []),
  ...(editable ? ["WRITE" as const, "SET" as const, "CHANGE" as const, "EDIT" as const] : []),
  ...(clearable ? ["CLEAR" as const] : []),
];

describe("M6F one multilingual action grammar", () => {
  it("keeps raw clinical text separate from the closed canonical command form", () => {
    const result = normalizeM6FCommandText("রোগী মেডিসিন বন্ধ করেছে");
    expect(result.rawTranscript).toBe("রোগী মেডিসিন বন্ধ করেছে");
    expect(result.canonicalCommandText).toBe("রোগী medicine বন্ধ করেছে");
    expect(parseM6FAction(result.rawTranscript)).toBeNull();
  });

  it("restores only the declared Bengali-script control vocabulary", () => {
    expect(normalizeM6FCommandText("স্ট্রেংথ পাঁচশো মিলিগ্রাম দাও").canonicalCommandText).toContain("strength");
    expect(Object.keys(M6F_CLOSED_ASR_RESTORATIONS).length).toBeGreaterThan(40);
  });

  it("generates thousands of valid action + target command surfaces", () => {
    const corpus = M6F_VOICE_SURFACE_INVENTORY.flatMap((surface) =>
      actionFor(surface.editable, surface.readable, surface.clearable).flatMap((action) =>
        m6fActionAliases(action).flatMap((alias) => [
          `${alias} ${surface.aliasesEnglish[0]}`,
          `${alias} ${surface.aliasesBangla[0]}`,
          `${alias} ${surface.aliasesBanglish[0]}`,
        ]),
      ),
    );
    expect(corpus.length).toBeGreaterThan(5_000);
    for (const command of corpus) expect(parseM6FAction(command), command).not.toBeNull();
  });
});
