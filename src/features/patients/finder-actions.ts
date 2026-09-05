"use server";

import { searchPatients } from "./queries";
import { classifyFinderTerm, rankFinderPatients } from "./finder-ranking";
import {
  getM1DoctorAuthority,
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
  const q = term.trim();
  const kind = classifyFinderTerm(q);
  if (q.length < 2 || kind === "INVALID") {
    return { ok: true, patients: [], canRegister: false, operationalOnly: false };
  }

  const authority = await getM1DoctorAuthority();
  const ownerDoctorId = authority.doctorId ?? undefined;

  // Name is discovery-only and is never run as a broad operational lookup.
  // It is allowed only when the server has resolved the caller's own doctor
  // repository; the DB query below applies owner_doctor_id before order/LIMIT.
  if (kind === "NAME" && !ownerDoctorId) {
    return { ok: true, patients: [], canRegister: false, operationalOnly: true };
  }

  const outcome = await searchPatients(q, 60, ownerDoctorId);
  if (!outcome.ok) {
    return { ok: false, message: "Patient search is temporarily unavailable." };
  }

  const ranked = rankFinderPatients(outcome.patients, q, 6);
  const contexts = authority.doctorId
    ? await getPatientAppointmentContexts(
        ranked.map((patient) => patient.id),
        authority,
      )
    : new Map();

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
