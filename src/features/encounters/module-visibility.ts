import type { RxModule, RxModuleSetting } from "@/features/doctor/rx-modules";
import type { DraftKey, DraftValues } from "./schema";

/**
 * WHICH CONSULTATION SECTIONS THE DOCTOR SEES.
 *
 * One rule, and it only ever runs in one direction:
 *
 *     CONFIGURATION MAY SIMPLIFY FUTURE INPUT.
 *     IT MAY NEVER MAKE ALREADY-RECORDED INFORMATION DISAPPEAR.
 *
 * So `use_during_consultation = false` hides a section that is EMPTY, and never
 * one that has something in it. A doctor who records an examination and later
 * turns Examination off still sees that examination — on this visit and on
 * every past visit — because the alternative is clinical text that is saved,
 * invisible, and unreachable through the interface that wrote it.
 *
 * WHAT IT IS COMPUTED FROM
 *
 * The SAVED encounter, not the live editor. Deciding from what is being typed
 * would make a section vanish the moment its last character was deleted and
 * reappear on the next keystroke — the layout jumping the doctor would then
 * have to type around. Visibility is settled when the screen loads and stays
 * put until it reloads.
 *
 * This is CONSULTATION visibility and nothing else. `show_on_print` is a
 * separate question with a separate answer, and hiding a field here never
 * removes anything from a prescription, a review bundle or the record.
 */

/** Where a module's content comes from — which decides what its toggle means. */
export type ModuleSource =
  /** Fields on the encounter draft. `keys` is every field that feeds the module. */
  | { kind: "draft"; keys: readonly DraftKey[] }
  /** Its own list editor, with its own rows. */
  | { kind: "list"; list: "diagnosis" | "investigation" }
  /**
   * The PATIENT's record, not this visit.
   *
   * These have no consultation input at all, and must not grow one: an editor
   * here would be a second place to record an allergy, and two places to record
   * one clinical fact is how they disagree. Their toggle therefore cannot hide
   * a consultation section, because there is none — see `MODULE_SOURCE`.
   */
  | { kind: "patient-record"; where: string };

export const MODULE_SOURCE: Record<RxModule, ModuleSource> = {
  CHIEF_COMPLAINT: { kind: "draft", keys: ["chiefComplaints"] },
  SYMPTOMS: { kind: "draft", keys: ["symptoms"] },
  /**
   * TWO fields, because the printed History section is built from both — the
   * bundle joins present illness and past history into one block. Hiding it
   * therefore requires BOTH to be empty, or half a doctor's history would go
   * out of reach.
   */
  HISTORY: { kind: "draft", keys: ["presentIllness", "pastHistory"] },
  VITALS: {
    kind: "draft",
    keys: [
      "vitalHeightCm",
      "vitalWeightKg",
      "vitalTemperatureC",
      "vitalPulseBpm",
      "vitalSystolic",
      "vitalDiastolic",
      "vitalRespRate",
      "vitalSpo2",
    ],
  },
  EXAMINATION: { kind: "draft", keys: ["examination"] },
  ASSESSMENT: { kind: "draft", keys: ["assessment"] },
  DIAGNOSIS: { kind: "list", list: "diagnosis" },
  INVESTIGATIONS: { kind: "list", list: "investigation" },
  ADVICE: { kind: "draft", keys: ["advice"] },
  /** The note and the date are one statement; either alone counts as content. */
  NEXT_VISIT: { kind: "draft", keys: ["nextVisitNote", "nextVisitOn"] },
  ALLERGY: { kind: "patient-record", where: "the patient's allergies" },
  LONG_TERM_MEDICINES: { kind: "patient-record", where: "the patient's long-term medicines" },
};

export interface SectionVisibility {
  visible: boolean;
  /**
   * Visible only because this visit already holds something. The screen says so
   * out loud, or a doctor who turned the section off would find it back with no
   * explanation and assume the setting had not saved.
   */
  shownBecauseFilled: boolean;
}

export type VisibilityMap = Record<RxModule, SectionVisibility>;

/** What the encounter already holds, beyond the draft fields. */
export interface FindingCounts {
  diagnoses: number;
  investigations: number;
}

function hasDraftContent(values: DraftValues, keys: readonly DraftKey[]): boolean {
  return keys.some((key) => (values[key] ?? "").trim() !== "");
}

/**
 * Resolve every module's consultation visibility.
 *
 * `config` is null when the doctor's configuration could not be read. That
 * shows EVERYTHING: a failed read must never be the reason a doctor cannot see
 * a field, and the cost of showing a section they had turned off is a moment's
 * confusion, while the cost of hiding one is clinical text they cannot reach.
 */
export function resolveVisibility(
  config: RxModuleSetting[] | null,
  values: DraftValues,
  findings: FindingCounts,
): VisibilityMap {
  const byModule = new Map((config ?? []).map((c) => [c.module, c]));
  const out = {} as VisibilityMap;

  for (const rxModule of Object.keys(MODULE_SOURCE) as RxModule[]) {
    const source = MODULE_SOURCE[rxModule];

    /**
     * A patient-level module has no consultation section to show or hide, so
     * its toggle decides nothing here. Reported as not visible rather than as
     * a hidden section, because there is nothing being withheld.
     */
    if (source.kind === "patient-record") {
      out[rxModule] = { visible: false, shownBecauseFilled: false };
      continue;
    }

    const enabled =
      config === null ? true : (byModule.get(rxModule)?.useDuringConsultation ?? true);
    const filled =
      source.kind === "list"
        ? (source.list === "diagnosis" ? findings.diagnoses : findings.investigations) > 0
        : hasDraftContent(values, source.keys);

    out[rxModule] = {
      visible: enabled || filled,
      shownBecauseFilled: !enabled && filled,
    };
  }

  return out;
}

/** Which draft fields a module owns — used to filter the editors themselves. */
export function draftKeysFor(rxModule: RxModule): readonly DraftKey[] {
  const source = MODULE_SOURCE[rxModule];
  return source.kind === "draft" ? source.keys : [];
}

/** The module a given draft field belongs to. Every field belongs to exactly one. */
export const MODULE_BY_DRAFT_KEY: ReadonlyMap<DraftKey, RxModule> = new Map(
  (Object.keys(MODULE_SOURCE) as RxModule[]).flatMap((rxModule) =>
    draftKeysFor(rxModule).map((key) => [key, rxModule] as const),
  ),
);
