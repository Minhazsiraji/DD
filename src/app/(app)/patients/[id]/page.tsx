import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  TriangleAlert,
  Droplet,
  Weight,
  Phone,
  Mail,
  MapPin,
  Activity,
  Pill,
  ShieldAlert,
  Users,
  Pencil,
} from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { PatientTimeline } from "@/features/patients/components/patient-timeline";
import { getPatient } from "@/features/patients/queries";
import {
  getPatientTimeline,
  TIMELINE_EVENT_TYPES,
  type TimelineEventType,
} from "@/features/patients/timeline";
import { formatAge } from "@/features/patients/identity";
import { SEX_LABEL, BLOOD_GROUP_LABEL } from "@/features/patients/schema";
import { cn } from "@/lib/utils";
import { SafetyList } from "@/features/patients/components/safety-list";

export async function generateMetadata(
  props: PageProps<"/patients/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  const patient = await getPatient(id);
  return { title: patient ? patient.fullName : "Patient" };
}

export default async function PatientProfilePage(props: PageProps<"/patients/[id]">) {
  const { id } = await props.params;
  const params = await props.searchParams;

  const patient = await getPatient(id);
  if (!patient) notFound();

  const rawType = typeof params.type === "string" ? params.type : "all";
  const activeType = (TIMELINE_EVENT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as TimelineEventType)
    : "all";
  const activeLocationId = typeof params.loc === "string" ? params.loc : "all";

  const history = await getPatientTimeline(id, {
    type: activeType,
    locationId: activeLocationId,
  });

  const age = formatAge({ years: patient.ageYears, isApproximate: patient.ageApproximate });
  const hasAllergies = patient.allergies.length > 0;
  const criticalAlerts = patient.alerts.filter(
    (a) => a.severity === "SERIOUS" || a.severity === "CRITICAL",
  );

  const bloodGroup =
    patient.bloodGroup !== "UNKNOWN"
      ? BLOOD_GROUP_LABEL[patient.bloodGroup as keyof typeof BLOOD_GROUP_LABEL]
      : "Not recorded";

  return (
    <div className="space-y-4 sm:space-y-5">
      <Link
        href="/patients"
        className="liquid-secondary inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Patients
      </Link>

      {/* Persistent patient context, visually based on the approved patient
          summary card while keeping allergy and serious alert content explicit. */}
      <section
        className={cn(
          "liquid-patient-summary sticky top-[108px] z-20 overflow-hidden p-4 sm:p-5",
          hasAllergies || criticalAlerts.length ? "liquid-patient-summary-danger" : "",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-start gap-3 sm:flex-nowrap sm:items-center">
          <div className="liquid-patient-avatar flex size-14 shrink-0 items-center justify-center rounded-full sm:size-16" aria-hidden="true">
            <Users className="size-6 sm:size-7" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="truncate text-[19px] font-semibold tracking-[-0.025em] text-[#292550] sm:text-[21px]">
                {patient.fullName}
              </h1>
              {criticalAlerts.length > 0 ? (
                <ShieldAlert className="size-4 shrink-0 text-danger" aria-label="Clinical alert" />
              ) : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[#6f6982]">
              <span className="font-mono">{patient.patientNumber}</span>
              <span aria-hidden="true">•</span>
              <span>{age}</span>
              <span aria-hidden="true">•</span>
              <span>{SEX_LABEL[patient.sex as keyof typeof SEX_LABEL] ?? patient.sex}</span>
            </p>
          </div>

          <Link
            href={`/patients/${id}/edit`}
            className="liquid-secondary inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-ink focus-visible:focus-ring"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </Link>
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
          <div className="liquid-patient-tile rounded-[16px] px-3 py-2.5">
            <p className="text-[10px] font-medium text-[#7e788e]">Blood Group</p>
            <p className="mt-1 text-[14px] font-semibold text-[#2d2857]">{bloodGroup}</p>
          </div>

          <div className={cn("liquid-patient-tile rounded-[16px] px-3 py-2.5", hasAllergies ? "liquid-patient-allergy" : "")}>
            <p className="text-[10px] font-medium text-[#7e788e]">Allergies</p>
            <p className={cn("mt-1 truncate text-[14px] font-semibold", hasAllergies ? "text-danger" : "text-[#2d2857]")}> 
              {hasAllergies ? patient.allergies.map((a) => a.substance).join(", ") : "None recorded"}
            </p>
          </div>

          <div className="liquid-patient-tile rounded-[16px] px-3 py-2.5">
            <p className="text-[10px] font-medium text-[#7e788e]">Weight</p>
            <p className="mt-1 text-[14px] font-semibold text-[#2d2857] tabular-nums">
              {patient.weightKg ? `${patient.weightKg} kg` : "Not recorded"}
            </p>
          </div>
        </div>

        {patient.conditions.length > 0 ? (
          <div className="liquid-patient-tile mt-2.5 rounded-[16px] px-3 py-2.5">
            <p className="text-[10px] font-medium text-[#7e788e]">Conditions</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {patient.conditions.map((c) => (
                <span key={c.id} className="liquid-secondary inline-flex min-h-7 items-center rounded-full px-2.5 text-[11px] font-medium text-[#4e477a]">
                  {c.condition}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {hasAllergies ? (
          <div className="mt-2.5 flex items-start gap-2 rounded-[15px] border border-danger/15 bg-danger-soft/88 px-3 py-2.5 text-[12px] font-semibold text-danger">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>Allergy: {patient.allergies.map((a) => a.substance).join(", ")}</span>
          </div>
        ) : null}

        {criticalAlerts.length > 0 ? (
          <ul className="mt-2.5 space-y-1.5">
            {criticalAlerts.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-[14px] border border-danger/12 bg-white/54 px-3 py-2 text-[12px] font-medium text-ink">
                <ShieldAlert className="size-4 shrink-0 text-danger" aria-hidden="true" />
                {a.message}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

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
                .filter(Boolean)
                .join(" · "),
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

          <SafetyList
            patientId={id}
            kind="medication"
            title="Long-term medicines"
            icon={<Pill className="size-4" />}
            items={patient.medications.map((m) => ({
              id: m.id,
              primary: m.name,
              secondary: [m.dose, m.source === "REPORTED" ? "as reported" : "prescribed"]
                .filter(Boolean)
                .join(" · "),
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
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
      <span className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true">
        {icon}
      </span>
      <dt className="w-24 shrink-0 text-ink-muted">{label}</dt>
      <dd className={cn("min-w-0 flex-1 break-words", value ? "text-ink" : "text-ink-muted")}>
        {value ?? "Not recorded"}
      </dd>
    </div>
  );
}
