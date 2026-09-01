/**
 * "Your Doctor's Diary setup" — derived, never remembered.
 *
 * THE RULE THIS FILE IS BUILT AROUND: progress is not a stored flag. There is
 * no `onboarding_completed_steps` column and there must not be one. Every tick
 * below is recomputed from the thing it claims — a chamber is done because a
 * chamber exists, booking is on because `booking_enabled` is true. A stored
 * flag drifts the moment a doctor deletes something, and a checklist that
 * congratulates you for a chamber you removed is worse than no checklist.
 *
 * FOUR STATES, NOT TWO. `UNKNOWN` matters as much as the other three: when a
 * read fails, the honest answer is "we could not check", and showing an empty
 * circle instead would tell a doctor they had not done something they had.
 *
 * This module is pure. It reads nothing and imports nothing — the snapshot
 * arrives assembled, which is what makes every rule here testable without a
 * database and impossible to make up.
 */

export type StepState = "DONE" | "PARTIAL" | "TODO" | "UNKNOWN";

export interface ChamberSnapshot {
  id: string;
  name: string;
  hasSchedule: boolean;
  bookingEnabled: boolean;
  hasFee: boolean;
}

/**
 * Everything the checklist is allowed to know.
 *
 * Notice what is absent: no patient names, no appointment details, no
 * consultation content. The checklist needs to know THAT a first patient
 * exists, never who they are — so there is nowhere in this shape to put one.
 *
 * A `null` field means the read failed or did not apply, and produces UNKNOWN.
 * A `false`/empty field means the read succeeded and the answer is no.
 */
export interface SetupSnapshot {
  profileExists: boolean;
  fullName: string | null;
  qualification: string | null;
  specialization: string | null;
  designation: string | null;
  hasPhoto: boolean | null;
  visibility: "PUBLIC" | "PRIVATE" | null;
  slug: string | null;
  chambers: ChamberSnapshot[] | null;
  /**
   * Practice locations the doctor is a member of, which is NOT the same as
   * chambers on their profile. Someone can have joined a clinic without ever
   * describing it publicly.
   */
  placeCount: number | null;
  hasPatients: boolean | null;
  hasCompletedConsultation: boolean | null;
}

export interface SetupStep {
  key: string;
  title: string;
  /** One line, addressed to the doctor, saying what to do — never a scold. */
  help: string;
  href: string;
  state: StepState;
  /** Why it is in that state, in the doctor's terms. Null when nothing to add. */
  evidence: string | null;
}

export interface SetupProgress {
  steps: SetupStep[];
  doneCount: number;
  total: number;
  /** Whole percent of DONE steps. PARTIAL does not count as done. */
  percent: number;
  /** The first step worth doing next, or null when everything is DONE. */
  nextStep: SetupStep | null;
  /** True when a read failed, so the UI can say so rather than imply zero. */
  incomplete: boolean;
}

const has = (v: string | null): boolean => typeof v === "string" && v.trim().length > 0;

/** DONE when all present, PARTIAL when some, TODO when none. */
function tally(flags: boolean[]): StepState {
  const done = flags.filter(Boolean).length;
  if (done === flags.length && flags.length > 0) return "DONE";
  return done > 0 ? "PARTIAL" : "TODO";
}

/** "2 of 3 chambers" — plural-safe, and never a bare number. */
function ofChambers(done: number, total: number): string {
  return `${done} of ${total} chamber${total === 1 ? "" : "s"}`;
}

export function deriveSetupProgress(snapshot: SetupSnapshot): SetupProgress {
  const chambers = snapshot.chambers;
  const chamberCount = chambers?.length ?? 0;

  const steps: SetupStep[] = [
    {
      key: "profile",
      title: "Professional profile",
      help: "Your name and how you are addressed.",
      href: "/settings/professional",
      state: snapshot.profileExists ? "DONE" : "TODO",
      evidence: snapshot.profileExists ? (snapshot.fullName ?? null) : null,
    },
    {
      key: "photo",
      title: "Profile photo",
      help: "Patients recognise a face before they read a qualification.",
      href: "/settings/professional",
      state: snapshot.hasPhoto === null ? "UNKNOWN" : snapshot.hasPhoto ? "DONE" : "TODO",
      evidence: snapshot.hasPhoto === false ? "No photo uploaded" : null,
    },
    {
      key: "credentials",
      title: "Qualifications & specialty",
      help: "MBBS, FCPS, your specialty — what a patient looks for first.",
      href: "/settings/professional",
      state: tally([has(snapshot.qualification), has(snapshot.specialization)]),
      evidence:
        [
          has(snapshot.qualification) ? null : "qualification",
          has(snapshot.specialization) ? null : "specialty",
        ]
          .filter(Boolean)
          .join(" and ") || null,
    },
    {
      key: "chambers",
      title: "Chambers",
      help: "Every place you see patients — chamber, clinic or hospital.",
      href: "/settings",
      state:
        chambers === null
          ? "UNKNOWN"
          : chamberCount > 0
            ? "DONE"
            : (snapshot.placeCount ?? 0) > 0
              ? "PARTIAL"
              : "TODO",
      evidence:
        chambers === null
          ? null
          : chamberCount > 0
            ? ofChambers(chamberCount, chamberCount)
            : (snapshot.placeCount ?? 0) > 0
              ? "Added, but not described on your profile yet"
              : null,
    },
    {
      key: "schedule",
      title: "Visiting schedule",
      help: "The days and hours you sit at each chamber.",
      href: "/settings/professional",
      state:
        chambers === null
          ? "UNKNOWN"
          : chamberCount === 0
            ? "TODO"
            : tally(chambers.map((c) => c.hasSchedule)),
      evidence:
        chambers && chamberCount > 0
          ? ofChambers(chambers.filter((c) => c.hasSchedule).length, chamberCount)
          : null,
    },
    {
      key: "fee",
      title: "Consultation fee",
      help: "What a visit costs, so a patient knows before they arrive.",
      href: "/settings/booking",
      state:
        chambers === null
          ? "UNKNOWN"
          : chamberCount === 0
            ? "TODO"
            : tally(chambers.map((c) => c.hasFee)),
      evidence:
        chambers && chamberCount > 0
          ? ofChambers(chambers.filter((c) => c.hasFee).length, chamberCount)
          : null,
    },
    {
      key: "visibility",
      title: "Public profile",
      help: "Whether patients can find you at all. Private until you say so.",
      href: "/settings/professional",
      state:
        snapshot.visibility === null
          ? "UNKNOWN"
          : snapshot.visibility === "PUBLIC"
            ? has(snapshot.slug)
              ? "DONE"
              : "PARTIAL"
            : "TODO",
      evidence:
        snapshot.visibility === "PUBLIC" && !has(snapshot.slug)
          ? "Public, but no profile link yet"
          : snapshot.visibility === "PRIVATE"
            ? "Private — nobody can find you yet"
            : null,
    },
    {
      key: "booking",
      title: "Online booking",
      help: "Let patients book a slot themselves, per chamber.",
      href: "/settings/booking",
      state:
        chambers === null
          ? "UNKNOWN"
          : chamberCount === 0
            ? "TODO"
            : tally(chambers.map((c) => c.bookingEnabled)),
      evidence:
        chambers && chamberCount > 0
          ? ofChambers(chambers.filter((c) => c.bookingEnabled).length, chamberCount)
          : null,
    },
    {
      key: "first-patient",
      title: "First patient registered",
      help: "Add a patient and their record starts.",
      href: "/patients/new",
      state:
        snapshot.hasPatients === null ? "UNKNOWN" : snapshot.hasPatients ? "DONE" : "TODO",
      evidence: null,
    },
    {
      key: "first-consultation",
      title: "First consultation completed",
      help: "The moment Doctor's Diary starts being your record, not a setup screen.",
      href: "/queue",
      state:
        snapshot.hasCompletedConsultation === null
          ? "UNKNOWN"
          : snapshot.hasCompletedConsultation
            ? "DONE"
            : "TODO",
      evidence: null,
    },
  ];

  const doneCount = steps.filter((s) => s.state === "DONE").length;
  const total = steps.length;

  return {
    steps,
    doneCount,
    total,
    percent: Math.round((doneCount / total) * 100),
    /*
     * The next step is the first that is not DONE and not UNKNOWN. Pointing a
     * doctor at something we failed to read would send them to a screen where
     * the work may already be finished.
     */
    nextStep: steps.find((s) => s.state === "TODO" || s.state === "PARTIAL") ?? null,
    incomplete: steps.some((s) => s.state === "UNKNOWN"),
  };
}
