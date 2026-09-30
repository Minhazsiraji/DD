import { describe, expect, it } from "vitest";
import { preserveBanglishClinicalEnglish } from "./banglish-script";

describe("Banglish clinical English preservation", () => {
  it("keeps Bangla text but restores common English clinical terms", () => {
    expect(
      preserveBanglishClinicalEnglish(
        "পেশেন্টের ফিভার আছে এবং প্যানক্রিয়াস নিয়ে কথা হয়েছে",
      ),
    ).toBe("patientের fever আছে এবং pancreas নিয়ে কথা হয়েছে");
  });

  it("leaves already-correct English clinical terms untouched", () => {
    expect(
      preserveBanglishClinicalEnglish("patient fever pancreas CBC"),
    ).toBe("patient fever pancreas CBC");
  });
});
