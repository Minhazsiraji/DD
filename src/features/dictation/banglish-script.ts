const BANGLISH_CLINICAL_SCRIPT_REPAIRS: readonly [string, string][] = [
  ["পেশেন্ট", "patient"],
  ["ফিভার", "fever"],
  ["প্যানক্রিয়াস", "pancreas"],
  ["প্যানক্রিয়াস", "pancreas"],
  ["ডায়াবেটিস", "diabetes"],
  ["ডায়াবেটিস", "diabetes"],
  ["হাইপারটেনশন", "hypertension"],
  ["ইনফেকশন", "infection"],
  ["সিবিসি", "CBC"],
  ["সিরাম ক্রিয়েটিনিন", "serum creatinine"],
  ["সিরাম ক্রিয়েটিনিন", "serum creatinine"],
  ["ক্রিয়েটিনিন", "creatinine"],
  ["ক্রিয়েটিনিন", "creatinine"],
  ["ইনসুলিন", "insulin"],
  ["ব্লাড প্রেসার", "blood pressure"],
  ["বিপি", "BP"],
  ["পালস", "pulse"],
  ["টেম্পারেচার", "temperature"],
  ["অক্সিজেন স্যাচুরেশন", "oxygen saturation"],
  ["এসপিওটু", "SpO2"],
  ["চেস্ট এক্স-রে", "chest X-ray"],
  ["চেস্ট এক্সরে", "chest X-ray"],
  ["সিরাম অ্যামাইলেজ", "serum amylase"],
  ["সিরাম লাইপেজ", "serum lipase"],
  ["মেটফরমিন", "metformin"],
  ["অ্যামলোডিপিন", "amlodipine"],
  ["এমলোডিপিন", "amlodipine"],
  ["পেনিসিলিন", "penicillin"],
  ["প্রোডাক্টিভ কফ", "productive cough"],
  ["শর্টনেস অফ ব্রেথ", "shortness of breath"],
  ["ক্রেপিটেশন", "crepitations"],
  ["ক্রেপিটেশন্স", "crepitations"],
  ["এপিগ্যাস্ট্রিক টেন্ডারনেস", "epigastric tenderness"],
];

/**
 * Banglish keeps genuine Bangla in Bangla script while restoring English
 * clinical terms that a Bengali-only STT stream sometimes transliterates.
 */
export function preserveBanglishClinicalEnglish(text: string): string {
  return BANGLISH_CLINICAL_SCRIPT_REPAIRS.reduce(
    (value, [from, to]) => value.replaceAll(from, to),
    text,
  );
}
