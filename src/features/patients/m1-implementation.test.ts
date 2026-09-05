import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = "5d58f154a8fd18129e28614ccc038f0a6af66b8f";
const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const code = (file: string) =>
  read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const patientsPage = () => code("src/app/(app)/patients/page.tsx");
const patientActions = () => code("src/features/patients/actions.ts");
const patientForm = () => code("src/features/patients/components/patient-form.tsx");
const patientProfile = () => code("src/app/(app)/patients/[id]/page.tsx");
const finder = () => code("src/features/patients/components/global-patient-finder.tsx");
const finderActions = () => code("src/features/patients/finder-actions.ts");
const context = () => code("src/features/patients/m1-context.ts");
const launcher = () => code("src/features/patients/components/doctor-consultation-launcher.tsx");
const encounterActions = () => code("src/features/encounters/actions.ts");
const start = () => code("src/features/queue/components/start-consultation.tsx");
const workNow = () => code("src/features/dashboard/components/work-now.tsx");

describe("M1 doctor repository and finder security", () => {
  it("1 scopes /patients to the current server-derived doctor", () => {
    expect(patientsPage()).toMatch(/getM1DoctorAuthority\(\)/);
    expect(patientsPage()).toMatch(/searchPatients\(query,\s*30,\s*doctorId \?\? undefined\)/);
  });

  it("2 never accepts ownerDoctorId from the browser finder", () => {
    expect(finderActions()).toMatch(/getM1DoctorAuthority\(\)/);
    expect(finderActions()).not.toMatch(/findPatientsAction\([^)]*ownerDoctorId/);
  });

  it("5 represents failed search as unavailable, not no patient", () => {
    expect(finderActions()).toContain("Patient search is temporarily unavailable.");
    expect(finder()).toContain("This is not the same as “no patient found”");
  });

  it("6 suppresses registration while finder search is unavailable", () => {
    const source = finder();
    const errorBranch = source.slice(source.indexOf("{error ?"), source.indexOf(": patients.length > 0"));
    expect(errorBranch).not.toContain("/patients/new");
    expect(errorBranch).toContain("Retry");
  });

  it("27 keeps shared Top Bar clinical actions capability-safe", () => {
    expect(finder()).toMatch(/selected\.canClinical && !operationalOnly/);
    expect(context()).toMatch(/doctorId && roleAllowsDoctor && capability && activeAtLocation/);
  });

  it("24 receptionist-only sessions cannot start unscheduled consultations", () => {
    expect(context()).toMatch(/ctx\.roles\.includes\("DOCTOR"\)/);
    expect(launcher()).not.toContain("RECEPTIONIST");
  });

  it("25 location-admin-only sessions cannot start unscheduled consultations", () => {
    expect(context()).toMatch(/roleAllowsDoctor/);
    expect(context()).not.toMatch(/LOCATION_ADMIN.*canClinical/);
  });

  it("26 operational-only finder results never render Resume/Open Notes", () => {
    expect(finder()).toMatch(/selected\.canClinical && !operationalOnly/);
    expect(finder()).not.toContain("Open notes");
  });
});

describe("M1 registration", () => {
  it("7 preserves submitted values across duplicate warnings/errors", () => {
    expect(patientActions()).toMatch(/values:\s*echo\(formData\)/);
    expect(patientForm()).toMatch(/submitted\?\.\[name\]/);
  });

  it("8 has only Register patient, never Register & start", () => {
    expect(patientForm()).toContain("Register patient");
    expect(patientForm()).not.toMatch(/Register\s*&\s*start|register_and_start/i);
  });

  it("9 redirects a successful registration to Patient Profile", () => {
    expect(patientActions()).toMatch(/redirect\(`\/patients\/\$\{patient\.patient_id\}`\)/);
  });

  it("33 rejects future DOB server-side and limits the date input", () => {
    expect(patientActions()).toMatch(/v\.dob > today/);
    expect(patientActions()).toContain("Date of birth cannot be in the future");
    expect(patientForm()).toMatch(/max=\{todayLocal\}/);
  });

  it("preserves the locked duplicate decisions", () => {
    expect(patientForm()).toContain("Use this patient");
    expect(patientForm()).toContain("I checked — this is a different person");
    expect(patientForm()).toMatch(/name="confirmedNotDuplicate"/);
  });

  it("keeps More details optional and collapsed for create", () => {
    expect(patientForm()).toMatch(/useState\(mode === "edit"\)/);
    expect(patientForm()).toContain("More details");
  });
});

describe("M1 consultation launcher state matrix", () => {
  it("10 gives a newly registered owned patient an unscheduled launcher on profile", () => {
    expect(patientProfile()).toContain("DoctorConsultationLauncher");
    expect(launcher()).toContain("Start unscheduled consultation");
  });

  it("11 gives an existing patient with NONE state unscheduled start", () => {
    expect(launcher()).toMatch(/state !== "NONE" && state !== "COMPLETED"/);
    expect(launcher()).toContain("Start unscheduled consultation");
  });

  it("resumes an existing unscheduled draft with the exact encounter id", () => {
    expect(context()).toContain("getExistingUnscheduledDraftId");
    expect(context()).toMatch(/\.is\("appointment_id",\s*null\)/);
    expect(patientProfile()).toContain("unscheduledEncounterId={unscheduledEncounterId}");
    expect(launcher()).toMatch(/if \(unscheduledEncounterId\)/);
    expect(launcher()).toContain("Resume consultation");
    expect(launcher()).toMatch(/router\.push\(`\/consultation\/\$\{unscheduledEncounterId\}`\)/);
    expect(launcher().indexOf('state === "ARRIVED"')).toBeLessThan(launcher().indexOf("if (unscheduledEncounterId)"));
  });

  it("12 constrains unscheduled lookup to appointment_id IS NULL", () => {
    expect(encounterActions()).toMatch(/\.is\("appointment_id",\s*null\)/);
  });

  it("13 unscheduled start creates no appointment", () => {
    const source = encounterActions();
    const body = source.slice(source.indexOf("export async function openUnscheduledConsultationAction"), source.indexOf("Save the sections"));
    expect(body).not.toMatch(/create_appointment|from\("appointments"\)\.insert|bookAppointment/);
  });

  it("14 unscheduled start creates no queue row or token", () => {
    const source = encounterActions();
    const body = source.slice(source.indexOf("export async function openUnscheduledConsultationAction"), source.indexOf("Save the sections"));
    expect(body).not.toMatch(/queue_entries|allocate_queue_token|queue_token/);
  });

  it("15 resumes one unscheduled draft before and after a concurrent conflict", () => {
    const source = encounterActions();
    expect(source.match(/findExistingUnscheduledDraft\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toMatch(/ENCOUNTER_DRAFT_ALREADY_EXISTS\|unique/);
  });

  it("16 ARRIVED uses appointment-linked Start", () => {
    expect(launcher()).toMatch(/state === "ARRIVED" && appointmentId/);
    expect(launcher()).toContain("<StartConsultation");
  });

  it("17 Start requires explicit patient/token confirmation", () => {
    expect(start()).toContain("Confirm the patient before opening their clinical record.");
    expect(start()).toContain("patientName");
    expect(start()).toContain("tokenNumber");
    expect(start()).toContain("Not yet");
  });

  it("18 successful appointment Start routes directly to Consultation Workspace", () => {
    expect(start()).toMatch(/changeStatusAction[\s\S]*openAppointmentConsultationAction/);
    expect(start()).toMatch(/router\.push\(`\/consultation\/\$\{opened\.encounterId\}`\)/);
  });

  it("19 IN_CONSULTATION resumes through the appointment-specific RPC", () => {
    expect(launcher()).toMatch(/state === "IN_CONSULTATION" && appointmentId/);
    expect(encounterActions()).toMatch(/rpc\("open_encounter_for_appointment"/);
  });

  it("uses legacy encounter RPCs only when V2 signatures are absent", () => {
    const source = encounterActions();
    expect(source).toMatch(/error\.code === "PGRST202"/);
    expect(source).toMatch(/p_appointment_id:\s*null/);
    expect(source).toMatch(/p_appointment_id:\s*parsed\.data\.appointmentId/);
    expect(source).toMatch(/p_practice_location_id:\s*authority\.locationId/);
  });

  it("20 SCHEDULED cannot direct clinical-start", () => {
    const source = launcher();
    const branch = source.slice(source.indexOf('state === "SCHEDULED"'), source.indexOf("// NONE and COMPLETED"));
    expect(branch).toContain("Mark arrived");
    expect(branch).not.toContain("Start consultation");
  });

  it("21 CONFIRMED cannot direct clinical-start", () => {
    const source = launcher();
    const branch = source.slice(source.indexOf('state === "SCHEDULED"'), source.indexOf("// NONE and COMPLETED"));
    expect(branch).toMatch(/state === "CONFIRMED"/);
    expect(branch).not.toContain("Start consultation");
  });

  it("22 never invents arrival authority", () => {
    expect(launcher()).toMatch(/if \(!canMarkArrived\)/);
    expect(context()).toMatch(/canMarkArrived:\s*canClinical/);
  });

  it("23 COMPLETED-only can deliberately start unscheduled", () => {
    expect(launcher()).toMatch(/state !== "NONE" && state !== "COMPLETED"/);
  });

  it("handles partial failure without rolling status backward", () => {
    expect(start()).toContain("Consultation has started, but the clinical workspace did not open.");
    expect(start()).toContain("Resume consultation");
    expect(start()).not.toMatch(/toStatus[\s\S]{0,80}ARRIVED/);
  });

  it("Work Now CURRENT is Resume and NEXT remains Start", () => {
    expect(workNow()).toContain("<OpenConsultation");
    expect(workNow()).toContain("<StartConsultation");
  });
});

describe("M1 Universal Finder interaction and mobile contract", () => {
  it("28 implements slash shortcut and ArrowUp/ArrowDown/Enter/Escape keyboard behavior", () => {
    const source = finder();
    for (const key of ['event.key !== "/"', 'event.key === "ArrowDown"', 'event.key === "ArrowUp"', 'event.key === "Enter"', 'event.key === "Escape"']) {
      expect(source).toContain(key);
    }
    expect(source).toMatch(/role:\s*"combobox"/);
    expect(source).toMatch(/role="listbox"/);
  });

  it("slash shortcut refuses to fire inside typing controls or consultation", () => {
    expect(finder()).toMatch(/input, textarea, select/);
    expect(finder()).toMatch(/pathname\.startsWith\("\/consultation\/"\)/);
  });

  it("29 implements 225ms debounce and stale request suppression", () => {
    expect(finder()).toContain("const DEBOUNCE_MS = 225");
    expect(finder()).toMatch(/seq !== requestSeq\.current/);
  });

  it("30 uses a mobile full-screen/sheet treatment instead of squeezing desktop dropdown", () => {
    expect(finder()).toMatch(/fixed inset-0/);
    expect(finder()).toMatch(/sm:hidden/);
    expect(finder()).toMatch(/h-12 w-full/);
  });

  it("31 keeps primary M1 touch targets at least 44px", () => {
    for (const source of [finder(), launcher(), start()]) expect(source).toContain("h-11");
  });

  it("32 retains approved hover/lift visual behavior", () => {
    const brand = read("src/app/canonical-brand.css");
    const app = read("src/app/app-unified-liquid.css");
    expect(brand).toMatch(/transform:\s*translateY\(-1px\)/);
    expect(app).toMatch(/dd-dashboard-card:hover/);
  });
});

describe("M1 accepted DB boundary", () => {
  it("appointment and unscheduled encounter entry paths stay distinct", () => {
    const source = encounterActions();
    expect(source).toMatch(/openAppointmentConsultationAction/);
    expect(source).toMatch(/openUnscheduledConsultationAction/);
    expect(source).toMatch(/open_encounter_for_appointment/);
    expect(source).toMatch(/rpc\("open_encounter"/);
  });

  it("34 has zero accepted DB product-tree drift from the authorized main SHA", () => {
    const paths = [
      "db/schema", "db/functions", "db/policies", "db/grants", "db/storage", "db/seed",
      "db/manifest.toml", "db/golden-p0.sql",
    ];
    expect(() => execFileSync("git", ["diff", "--exit-code", BASE, "--", ...paths], { stdio: "pipe" })).not.toThrow();
  });
});
