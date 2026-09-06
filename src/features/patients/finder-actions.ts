"use server";

import { searchFinderPatients } from "./queries";
import { classifyFinderTerm, rankFinderPatients } from "./finder-ranking";
import {
  getM1DoctorAuthority,
  getM1FinderScope,
  getPatientAppointmentContexts,
  type M1PatientState,
} from "./m1-context";

export interface FinderPatientResult {
  id: string;
  patientNumber: string;
  fullName: string;
  phone: string | null;
  ageYears: number | null;
  ageApproximate: boolean;
  sex: string;
  allergyCount: number;
  contextState: M1PatientState;
  appointmentId: string | null;
  tokenNumber: number | null;
  canClinical: boolean;
  canMarkArrived: boolean;
  locationName: string;
}

export type FinderOutcome =
  | {
      ok: true;
      patients: FinderPatientResult[];
      canRegister: boolean;
      operationalOnly: boolean;
    }
  | { ok: false; message: string };

export async function findPatientsAction(term: string): Promise<FinderOutcome> {
  const startedAt = Date.now();
  const q = term.trim();
  const kind = classifyFinderTerm(q);
  if (q.length < 2 || kind === "INVALID") {
    return { ok: true, patients: [], canRegister: false, operationalOnly: false };
  }

  // Start the full clinical-authority check immediately, but do not make the
  // patient query wait for capability/active-location RPCs. The shared Finder
  // scope supplies the server-derived doctor owner needed for DB scoping.
  const authorityPromise = getM1DoctorAuthority();
  const scope = await getM1FinderScope();
  const scopeMs = Date.now() - startedAt;
  const ownerDoctorId = scope.doctorId ?? undefined;

  // Name is discovery-only and is never run as a broad operational lookup.
  // It is allowed only when the server has resolved the caller's own doctor
  // repository; the DB query below applies owner_doctor_id before order/LIMIT.
  if (kind === "NAME" && !ownerDoctorId) {
    return { ok: true, patients: [], canRegister: false, operationalOnly: true };
  }

  const [outcome, authority] = await Promise.all([
    searchFinderPatients(q, 60, ownerDoctorId),
    authorityPromise,
  ]);
  const searchAuthorityMs = Date.now() - startedAt - scopeMs;
  if (!outcome.ok) {
    return { ok: false, message: "Patient search is temporarily unavailable." };
  }

  const ranked = rankFinderPatients(outcome.patients, q, 6);
  const contextStartedAt = Date.now();
  const contexts = authority.doctorId
    ? await getPatientAppointmentContexts(
        ranked.map((patient) => patient.id),
        authority,
      )
    : new Map();
  const contextMs = Date.now() - contextStartedAt;

  if (process.env.VERCEL_ENV !== "production") {
    console.info("[m1-finder-perf]", {
      scopeMs,
      searchAuthorityMs,
      contextMs,
      totalMs: Date.now() - startedAt,
    });
  }

  if (authority.doctorId && contexts === null) {
    return { ok: false, message: "Patient search is temporarily unavailable." };
  }

  return {
    ok: true,
    canRegister: authority.canClinical,
    operationalOnly: !authority.canClinical,
    patients: ranked.map((patient) => {
      const context = contexts?.get(patient.id);
      return {
        id: patient.id,
        patientNumber: patient.patientNumber,
        fullName: patient.fullName,
        phone: patient.phone,
        ageYears: patient.ageYears,
        ageApproximate: patient.ageApproximate,
        sex: patient.sex,
        allergyCount: patient.allergyCount,
        contextState: context?.state ?? "NONE",
        appointmentId: context?.appointmentId ?? null,
        tokenNumber: context?.tokenNumber ?? null,
        canClinical: authority.canClinical,
        canMarkArrived: authority.canMarkArrived,
        locationName: authority.locationName,
      };
    }),
  };
}
