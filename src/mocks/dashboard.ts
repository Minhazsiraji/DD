import type { DashboardData, PatientSummary } from "./types";

/**
 * MOCK DATA ONLY — every person below is fictional.
 *
 * Dates are hard-coded rather than derived from `new Date()` so server and
 * client render identically (no hydration mismatch) and the build stays
 * deterministic. Phase 3+ replaces this module with real queries.
 */

const TODAY = "2026-08-07";

function patient(p: Omit<PatientSummary, "alerts"> & Partial<Pick<PatientSummary, "alerts">>): PatientSummary {
  return { alerts: [], ...p };
}

const karim = patient({
  id: "p-001",
  patientNumber: "AR-000117",
  fullName: "Karim Ahmed",
  ageYears: 62,
  dobPrecision: "DAY",
  sex: "male",
  phone: "+8801711000117",
  bloodGroup: "B+",
  weightKg: 74,
  allergies: ["Penicillin"],
  conditions: ["Type 2 Diabetes", "Hypertension"],
  alerts: [
    { id: "a1", severity: "serious", label: "Penicillin allergy" },
    { id: "a2", severity: "caution", label: "eGFR 48 — reduced renal function" },
  ],
  lastVisitOn: "2026-07-10",
});

const rahim = patient({
  id: "p-002",
  patientNumber: "AR-000124",
  fullName: "Rahim Hossain",
  ageYears: 56,
  dobPrecision: "DAY",
  sex: "male",
  phone: "+8801711000124",
  bloodGroup: "O+",
  weightKg: 68,
  allergies: [],
  conditions: ["Type 2 Diabetes"],
  alerts: [{ id: "a3", severity: "caution", label: "HbA1c 8.4% at last visit" }],
  lastVisitOn: "2026-07-24",
});

const salma = patient({
  id: "p-003",
  patientNumber: "AR-000131",
  fullName: "Salma Begum",
  ageYears: 34,
  dobPrecision: "YEAR",
  sex: "female",
  phone: "+8801711000131",
  bloodGroup: "A+",
  weightKg: 59,
  allergies: ["Sulfa drugs"],
  conditions: [],
  alerts: [{ id: "a4", severity: "serious", label: "Sulfa allergy" }],
  lastVisitOn: null,
});

const faisal = patient({
  id: "p-004",
  patientNumber: "AR-000102",
  fullName: "Faisal Karim",
  ageYears: 45,
  dobPrecision: "DAY",
  sex: "male",
  phone: "+8801711000102",
  bloodGroup: "AB+",
  weightKg: 81,
  allergies: [],
  conditions: ["Dyslipidaemia"],
  lastVisitOn: "2026-06-30",
});

const nusrat = patient({
  id: "p-005",
  patientNumber: "AR-000145",
  fullName: "Nusrat Jahan",
  ageYears: 29,
  dobPrecision: "DAY",
  sex: "female",
  phone: "+8801711000145",
  bloodGroup: "B-",
  weightKg: 54,
  allergies: [],
  conditions: [],
  lastVisitOn: "2026-05-19",
});

export const dashboardData: DashboardData = {
  todayISO: TODAY,

  doctor: {
    id: "d-001",
    fullName: "Dr. Ayesha Rahman",
    qualification: "MBBS, FCPS (Medicine)",
    specialization: "Internal Medicine & Diabetology",
    registrationNo: "BMDC A-48211",
    avatarUrl: null,
    practiceName: "Dr. Ayesha Rahman's Practice",
  },

  /**
   * The doctor practises in three places. Patients belong to the DOCTOR, so a
   * patient first seen at Greenview and later at Popular is one record with one
   * timeline — which is the whole point of the product. Each clinic keeps
   * running its own system; we do not try to replace it.
   */
  locations: [
    {
      id: "loc-1",
      name: "Greenview Chamber, Dhanmondi",
      type: "OWN_CHAMBER",
      address: "House 42, Road 9/A, Dhanmondi, Dhaka",
      consultationFee: 1200,
      followUpFee: 800,
      slotMinutes: 15,
      isActive: true,
    },
    {
      id: "loc-2",
      name: "Popular Diagnostic, Shyamoli",
      type: "CLINIC",
      address: "Mirpur Road, Shyamoli, Dhaka",
      consultationFee: 1500,
      followUpFee: 1000,
      slotMinutes: 12,
      isActive: true,
    },
    {
      id: "loc-3",
      name: "Online consultation",
      type: "TELEMEDICINE",
      address: null,
      consultationFee: 1000,
      followUpFee: 600,
      slotMinutes: 15,
      isActive: true,
    },
  ],

  activeLocationId: "loc-1",

  stats: {
    appointmentsToday: 24,
    waiting: 7,
    reportsPending: 3,
    followUpsDue: 5,
  },

  currentToken: 17,

  currentPatient: {
    id: "q-017",
    tokenNumber: 17,
    queuePosition: 0,
    patient: karim,
    visitType: "FOLLOWUP",
    status: "IN_CONSULTATION",
    paymentStatus: "PAID",
    scheduledAt: "18:00",
    expectedAt: "18:04",
    checkedInAt: "17:46",
    isPriority: false,
  },

  nextPatient: {
    id: "q-018",
    tokenNumber: 18,
    queuePosition: 1,
    patient: rahim,
    visitType: "FOLLOWUP",
    status: "IN_QUEUE",
    paymentStatus: "UNPAID",
    scheduledAt: "18:15",
    expectedAt: "18:12",
    checkedInAt: "17:58",
    isPriority: false,
  },

  queue: [
    {
      id: "q-018",
      tokenNumber: 18,
      queuePosition: 1,
      patient: rahim,
      visitType: "FOLLOWUP",
      status: "IN_QUEUE",
      paymentStatus: "UNPAID",
      scheduledAt: "18:15",
      expectedAt: "18:12",
      checkedInAt: "17:58",
      isPriority: false,
    },
    {
      id: "q-019",
      tokenNumber: 19,
      queuePosition: 2,
      patient: salma,
      visitType: "NEW",
      status: "CHECKED_IN",
      paymentStatus: "PAID",
      scheduledAt: "18:30",
      expectedAt: "18:21",
      checkedInAt: "18:02",
      isPriority: false,
    },
    {
      id: "q-020",
      tokenNumber: 20,
      queuePosition: 3,
      patient: faisal,
      visitType: "REPORT_REVIEW",
      status: "CONFIRMED",
      paymentStatus: "PARTIAL",
      scheduledAt: "18:45",
      expectedAt: "18:35",
      checkedInAt: null,
      isPriority: false,
    },
    {
      id: "q-021",
      tokenNumber: 21,
      queuePosition: 4,
      patient: nusrat,
      visitType: "FOLLOWUP",
      status: "CHECKED_IN",
      paymentStatus: "PAID",
      scheduledAt: "19:00",
      expectedAt: "18:42",
      checkedInAt: "18:11",
      isPriority: false,
    },
  ],

  schedule: [
    { id: "s-1", time: "17:30", patientName: "Mahfuz Alam", visitType: "FOLLOWUP", status: "COMPLETED" },
    { id: "s-2", time: "17:45", patientName: "Tanvir Islam", visitType: "NEW", status: "COMPLETED" },
    { id: "s-3", time: "18:00", patientName: "Karim Ahmed", visitType: "FOLLOWUP", status: "IN_CONSULTATION" },
    { id: "s-4", time: "18:15", patientName: "Rahim Hossain", visitType: "FOLLOWUP", status: "IN_QUEUE" },
    { id: "s-5", time: "18:30", patientName: "Salma Begum", visitType: "NEW", status: "CHECKED_IN" },
    { id: "s-6", time: "18:45", patientName: "Faisal Karim", visitType: "REPORT_REVIEW", status: "CONFIRMED" },
    { id: "s-7", time: "19:00", patientName: "Nusrat Jahan", visitType: "FOLLOWUP", status: "CHECKED_IN" },
    { id: "s-8", time: "19:15", patientName: "Sabbir Rahman", visitType: "NEW", status: "CONFIRMED" },
  ],

  reports: [
    {
      id: "r-1",
      patientName: "Rahim Hossain",
      patientNumber: "AR-000124",
      testName: "HbA1c",
      requestedOn: "2026-07-24",
      receivedOn: "2026-08-06",
      isAbnormal: true,
    },
    {
      id: "r-2",
      patientName: "Faisal Karim",
      patientNumber: "AR-000102",
      testName: "Lipid Profile",
      requestedOn: "2026-07-28",
      receivedOn: "2026-08-05",
      isAbnormal: true,
    },
    {
      id: "r-3",
      patientName: "Karim Ahmed",
      patientNumber: "AR-000117",
      testName: "Serum Creatinine",
      requestedOn: "2026-07-10",
      receivedOn: null,
      isAbnormal: false,
    },
  ],

  followUps: [
    {
      id: "f-1",
      patientName: "Mahmuda Khatun",
      patientNumber: "AR-000098",
      reason: "Post-treatment review",
      dueOn: "2026-07-30",
      status: "overdue",
    },
    {
      id: "f-2",
      patientName: "Imran Sheikh",
      patientNumber: "AR-000110",
      reason: "BP reassessment",
      dueOn: "2026-08-03",
      status: "overdue",
    },
    {
      id: "f-3",
      patientName: "Rina Akter",
      patientNumber: "AR-000121",
      reason: "Thyroid review after reports",
      dueOn: "2026-08-07",
      status: "recommended",
    },
    {
      id: "f-4",
      patientName: "Jashim Uddin",
      patientNumber: "AR-000133",
      reason: "Diabetes 3-month review",
      dueOn: "2026-08-09",
      status: "recommended",
    },
    {
      id: "f-5",
      patientName: "Parvin Sultana",
      patientNumber: "AR-000140",
      reason: "Anaemia recheck",
      dueOn: "2026-08-11",
      status: "booked",
    },
  ],

  recentPatients: [
    {
      id: "p-006",
      patientNumber: "AR-000091",
      fullName: "Mahfuz Alam",
      ageYears: 51,
      sex: "male",
      seenOn: TODAY,
      reason: "Hypertension follow-up",
      locationName: "Greenview Chamber",
    },
    {
      id: "p-007",
      patientNumber: "AR-000088",
      fullName: "Tanvir Islam",
      ageYears: 38,
      sex: "male",
      seenOn: TODAY,
      reason: "Fever, 4 days",
      locationName: "Greenview Chamber",
    },
    {
      id: "p-008",
      patientNumber: "AR-000079",
      fullName: "Shirin Akhter",
      ageYears: 44,
      sex: "female",
      seenOn: "2026-08-06",
      reason: "Gastritis",
      locationName: "Popular Diagnostic",
    },
    {
      id: "p-009",
      patientNumber: "AR-000064",
      fullName: "Abdul Mannan",
      ageYears: 67,
      sex: "male",
      seenOn: "2026-08-06",
      reason: "Diabetes review",
      locationName: "Online consultation",
    },
  ],

  attention: [
    {
      id: "at-1",
      severity: "serious",
      title: "Abnormal HbA1c received",
      detail: "Rahim Hossain — HbA1c 9.1% (was 8.4%). Requested 24 Jul, received yesterday.",
    },
    {
      id: "at-2",
      severity: "caution",
      title: "Allergy recorded for a patient in today's queue",
      detail: "Salma Begum (Token 19) — sulfa drug allergy on file.",
    },
    {
      id: "at-3",
      severity: "caution",
      title: "Investigation ordered but no result attached",
      detail: "Karim Ahmed — serum creatinine requested 10 Jul, still pending.",
    },
    {
      id: "at-4",
      severity: "none",
      title: "2 follow-ups overdue",
      detail: "Mahmuda Khatun and Imran Sheikh have passed their recommended review date.",
    },
  ],
};

