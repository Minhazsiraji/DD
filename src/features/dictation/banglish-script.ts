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
  ["ক্রিয়েটিনিন", "creatinine"],
  ["ক্রিয়েটিনিন", "creatinine"],
  ["ইনসুলিন", "insulin"],
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
