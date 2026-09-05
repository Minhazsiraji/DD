import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, TriangleAlert, Droplet, Weight, Phone, Mail, MapPin,
  Activity, Pill, ShieldAlert, Users, Pencil,
} from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { PatientTimeline } from "@/features/patients/components/patient-timeline";
import { getPatient } from "@/features/patients/queries";
import { getPatientTimeline, TIMELINE_EVENT_TYPES, type TimelineEventType } from "@/features/patients/timeline";
import { formatAge } from "@/features/patients/identity";
import { SEX_LABEL, BLOOD_GROUP_LABEL } from "@/features/patients/schema";
import { cn } from "@/lib/utils";
import { SafetyList } from "@/features/patients/components/safety-list";
import { DoctorConsultationLauncher } from "@/features/patients/components/doctor-consultation-launcher";
import {
  getExistingUnscheduledDraftId,
  getM1DoctorAuthority,
  getPatientAppointmentContexts,
} from "@/features/patients/m1-context";

export async function generateMetadata(
  props: PageProps<"/patients/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  const patient = await getPatient(id);
  // Never leak a name to a browser tab for a record the caller cannot open.
  return { title: patient ? patient.fullName : "Patient" };
}

export default async function PatientProfilePage(props: PageProps<"/patients/[id]">) {
  const { id } = await props.params;
  const params = await props.searchParams;

  const patient = await getPatient(id);
  // RLS already filtered this. A patient belonging to another doctor is
  // indistinguishable from one that does not exist — deliberately.
  if (!patient) notFound();

  const rawType = typeof params.type === "string" ? params.type : "all";
  const activeType = (TIMELINE_EVENT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as TimelineEventType)
    : "all";
  const activeLocationId = typeof params.loc === "string" ? params.loc : "all";

  const [history, authority] = await Promise.all([
    getPatientTimeline(id, {
      type: activeType,
      locationId: activeLocationId,
    }),
    getM1DoctorAuthority(),
  ]);

  const ownsPatient = Boolean(
    authority.canClinical &&
      authority.doctorId &&
      patient.ownerDoctorId === authority.doctorId,
  );
  const [appointmentContexts, unscheduledEncounterId] = ownsPatient
    ? await Promise.all([
        getPatientAppointmentContexts([id], authority),
        getExistingUnscheduledDraftId(id, authority),
      ])
    : [new Map(), null];
  const appointmentContext = appointmentContexts?.get(id) ?? null;

  const age = formatAge({ years: patient.ageYears, isApproximate: patient.ageApproximate });
  const hasAllergies = patient.allergies.length > 0;
  const criticalAlerts = patient.alerts.filter(
    (a) => a.severity === "SERIOUS" || a.severity === "CRITICAL",
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <Link
        href="/patients"
        className="inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Patients
      </Link>

      {/* ---- SAFETY HEADER ----
          Sticky and opaque. This is the highest-value information on the screen
          and must stay legible while scrolling a long record. Never glass. */}
      <div className="clinical-surface sticky top-16 z-20 overflow-hidden rounded-glass-lg border-l-4 shadow-soft"
        style={{ borderLeftColor: hasAllergies || criticalAlerts.length ? "var(--dd-danger)" : "var(--dd-brand)" }}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3 sm:px-5">
          <h1 className="text-lg font-semibold text-ink">{patient.fullName}</h1>
          <span className="text-sm text-ink-secondary tabular-nums">
            {age} · {SEX_LABEL[patient.sex as keyof typeof SEX_LABEL] ?? patient.sex}
          </span>
          <span className="font-mono text-xs text-ink-muted">{patient.patientNumber}</span>
          <Link
            href={`/patients/${id}/edit`}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </Link>
        </div>

        {ownsPatient && appointmentContext ? (
          <div className="border-t border-hairline px-4 py-3 sm:px-5">
            <DoctorConsultationLauncher
              patientId={patient.id}
              patientName={patient.fullName}
              patientNumber={patient.patientNumber}
              state={appointmentContext.state}
              appointmentId={appointmentContext.appointmentId}
              unscheduledEncounterId={unscheduledEncounterId}
              tokenNumber={appointmentContext.tokenNumber}
              locationName={authority.locationName}
              canMarkArrived={authority.canMarkArrived}
            />
          </div>
        ) : null}

        <div className="px-4 pt-2 pb-3 sm:px-5">
          {hasAllergies ? (
            <p className="flex items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[13px] font-semibold text-[#a81c1c]">
              <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-bold uppercase">Allergy:</span>{" "}
                {patient.allergies.map((a) => a.substance).join(", ")}
              </span>
            </p>
          ) : (
            <p className="text-[13px] text-ink-muted">No known drug allergies recorded</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline px-4 py-2.5 text-[13px] sm:px-5">
          {patient.bloodGroup !== "UNKNOWN" ? (
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <Droplet className="size-3.5 text-ink-muted" aria-hidden="true" />
              <strong className="font-semibold text-ink tabular-nums">
                {BLOOD_GROUP_LABEL[patient.bloodGroup as keyof typeof BLOOD_GROUP_LABEL]}
              </strong>
            </span>
          ) : null}
          {patient.weightKg ? (
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <Weight className="size-3.5 text-ink-muted" aria-hidden="true" />
              <strong className="font-semibold text-ink tabular-nums">
                {patient.weightKg} kg
              </strong>
            </span>
          ) : null}
          {patient.conditions.length > 0 ? (
            <span className="text-ink-secondary">
              {patient.conditions.map((c) => c.condition).join(" · ")}
            </span>
          ) : null}
        </div>

        {criticalAlerts.length > 0 ? (
          <ul className="divide-y divide-hairline border-t border-hairline">
            {criticalAlerts.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-4 py-2 text-[13px] text-ink sm:px-5">
                <ShieldAlert className="size-4 shrink-0 text-danger" aria-hidden="true" />
                {a.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid gap-4 sm:gap-5 xl:grid-cols-3">
        <div className="space-y-4 sm:space-y-5 xl:col-span-2">
          <PatientTimeline
            patientId={id}
            events={history.events}
            missing={history.missing}
            activeType={activeType}
            activeLocationId={activeLocationId}
            locations={patient.locations}
          />
        </div>

        <div className="space-y-4 sm:space-y-5">
          {/* Editable. An allergy is usually discovered at a LATER visit, so a
              record that can only capture it at registration will go stale in
              exactly the field where stale is most dangerous. */}
          <SafetyList
            patientId={id}
            kind="allergy"
            title="Allergies"
            icon={<TriangleAlert className="size-4" />}
            danger
            items={patient.allergies.map((a) => ({
              id: a.id,
              primary: a.substance,
              secondary: [a.reaction, a.severity.toLowerCase().replace("_", " ")]
                .filter(Boolean).join(" · "),
            }))}
            emptyText="No known drug allergies recorded"
            placeholder="e.g. Penicillin"
          />

          <SafetyList
            patientId={id}
            kind="condition"
            title="Conditions"
            icon={<Activity className="size-4" />}
            items={patient.conditions.map((c) => ({
              id: c.id,
              primary: c.condition,
              secondary: c.status.toLowerCase(),
            }))}
            emptyText="No chronic conditions recorded"
            placeholder="e.g. Type 2 Diabetes"
          />

          {/*
            "Current medicines" read as "what is on the latest prescription",
            which it is not. This is the patient-level list a doctor keeps for
            safety: what the person is on long-term, whoever prescribed it,
            including drugs they only reported. Two different concepts, and the
            old label let them be confused.

            Deliberately NOT populated from prescriptions. Doing that
            automatically needs a product decision about what counts as
            stopped, and getting it wrong leaves a discontinued drug sitting on
            a safety list.
          */}
          <SafetyList
            patientId={id}
            kind="medication"
            title="Long-term medicines"
            icon={<Pill className="size-4" />}
            items={patient.medications.map((m) => ({
              id: m.id,
              primary: m.name,
              secondary: [m.dose, m.source === "REPORTED" ? "as reported" : "prescribed"]
                .filter(Boolean).join(" · "),
            }))}
            emptyText="No medicines recorded"
            placeholder="e.g. Metformin 500mg"
          />

          <SafetyList
            patientId={id}
            kind="alert"
            title="Alerts"
            icon={<ShieldAlert className="size-4" />}
            items={patient.alerts.map((a) => ({
              id: a.id,
              primary: a.message,
              secondary: a.severity.toLowerCase(),
            }))}
            emptyText="No alerts recorded"
            placeholder="e.g. Reduced renal function"
          />

          <SectionCard className="overflow-hidden">
            <SectionHeader title="Contact" icon={<Phone className="size-4" />} />
            <dl className="divide-y divide-hairline text-[13px]">
              <Row icon={<Phone className="size-3.5" />} label="Phone" value={patient.phone} />
              <Row icon={<Mail className="size-3.5" />} label="Email" value={patient.email} />
              <Row
                icon={<MapPin className="size-3.5" />}
                label="Address"
                value={[patient.address, patient.district].filter(Boolean).join(", ") || null}
              />
              {patient.contacts.map((c) => (
                <Row
                  key={c.id}
                  icon={<Users className="size-3.5" />}
                  label={c.relationship || "Emergency"}
                  value={[c.name, c.phone].filter(Boolean).join(" · ")}
                />
              ))}
            </dl>
          </SectionCard>
        </div>
      </div>

      <p className="text-center text-xs text-ink-muted">
        This record belongs to you. If this person also sees another doctor,
        that is a separate record you cannot see — and they cannot see this one.
      </p>
    </div>
  );
}

function Row({
  icon, label, value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
      <span className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true">{icon}</span>
      <dt className="w-24 shrink-0 text-ink-muted">{label}</dt>
      <dd className={cn("min-w-0 flex-1 break-words", value ? "text-ink" : "text-ink-muted")}>
        {value ?? "Not recorded"}
      </dd>
    </div>
  );
}

