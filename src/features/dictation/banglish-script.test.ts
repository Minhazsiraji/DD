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

  it("repairs common mixed-mode medical and vital terms without touching ordinary Bangla", () => {
    expect(
      preserveBanglishClinicalEnglish(
        "ব্লাড প্রেসার 136/84, পালস 96, অক্সিজেন স্যাচুরেশন 95%, সিবিসি, সিরাম ক্রিয়েটিনিন, মেটফরমিন",
      ),
    ).toBe("blood pressure 136/84, pulse 96, oxygen saturation 95%, CBC, serum creatinine, metformin");
  });
});
