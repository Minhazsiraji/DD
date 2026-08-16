/**
 * Shared expectations for patient-name and phone normalisation.
 *
 * The rules exist TWICE: in TypeScript (src/features/patients/identity.ts, used
 * when a doctor registers) and in SQL (normalize_patient_name /
 * normalize_patient_phone, used when reception registers — derived there
 * because a caller-supplied search key can be dishonest).
 *
 * If the two drift, duplicate detection silently stops matching records created
 * through the other path, and nothing fails loudly. So both are asserted
 * against THIS file: the vitest suite checks the TypeScript, and
 * verify-appointments.mjs checks the SQL.
 */

export const NAME_VECTORS = [
  // Honorifics — near-universal in Bangladesh and inconsistently written.
  ["Md. Rahim Hossain", "rahim hossain"],
  ["MD Rahim Hossain", "rahim hossain"],
  ["Mohammad Rahim Hossain", "rahim hossain"],
  ["Rahim Hossain", "rahim hossain"],
  ["Dr. Ayesha Rahman", "ayesha rahman"],
  ["Mrs Fatima Begum", "fatima begum"],
  // Stacked honorifics must reduce fully.
  ["Md. Alhaj Rahim", "rahim"],
  // Whitespace and punctuation.
  ["  Rahim   Hossain  ", "rahim hossain"],
  ["Rahim-Hossain", "rahim hossain"],
  ["Rahim.Hossain", "rahim hossain"],
  ["RAHIM HOSSAIN", "rahim hossain"],
  // A name that merely starts with the same letters is NOT an honorific.
  ["Mdhuri Sarkar", "mdhuri sarkar"],
  ["Missba Khan", "missba khan"],
  // An honorific with no name after it is NOT stripped — the pattern requires
  // trailing whitespace, so "md" survives rather than normalising to nothing.
  // Deliberate: a record whose key is the empty string would match every other
  // empty-keyed record.
  ["Md.", "md"],
];

export const PHONE_VECTORS = [
  ["01711000124", "01711000124"],
  ["+8801711000124", "01711000124"],
  ["8801711000124", "01711000124"],
  ["+880 1711-000124", "01711000124"],
  ["1711000124", "01711000124"],
  ["017 1100 0124", "01711000124"],
  // Not a Bangladeshi mobile shape — kept as digits rather than mangled.
  ["029876543", "029876543"],
  ["", null],
  ["   ", null],
  ["abc", null],
  [null, null],
];
