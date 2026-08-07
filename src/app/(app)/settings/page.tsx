import type { Metadata } from "next";
import { Building2, Hospital, Video, Check } from "lucide-react";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { AddClinicForm } from "@/features/clinics/components/add-clinic-form";
import {
  requireUser,
  getMemberships,
  ACTIVE_CLINIC_COOKIE,
} from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

type ClinicType = "OWN_CHAMBER" | "CLINIC" | "HOSPITAL" | "TELEMEDICINE";

const TYPE_ICON: Record<ClinicType, React.ReactNode> = {
  OWN_CHAMBER: <Building2 className="size-4" />,
  CLINIC: <Hospital className="size-4" />,
  HOSPITAL: <Hospital className="size-4" />,
  TELEMEDICINE: <Video className="size-4" />,
};

const TYPE_LABEL: Record<ClinicType, string> = {
  OWN_CHAMBER: "Own chamber",
  CLINIC: "Clinic",
  HOSPITAL: "Hospital",
  TELEMEDICINE: "Telemedicine",
};

const ROLE_LABEL: Record<string, string> = {
  DOCTOR: "Doctor",
  RECEPTIONIST: "Reception",
  CLINIC_ADMIN: "Admin",
};

export default async function SettingsPage() {
  await requireUser();
  const memberships = await getMemberships();
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from("clinics")
    .select("id, name, type, address, district, phone")
    .in(
      "id",
      memberships.map((m) => m.clinicId),
    );

  const cookieStore = await cookies();
  const activeId =
    cookieStore.get(ACTIVE_CLINIC_COOKIE)?.value ?? memberships[0]?.clinicId;

  const clinics = memberships.map((m) => {
    const row = rows?.find((r) => r.id === m.clinicId);
    return {
      id: m.clinicId,
      name: m.clinicName,
      type: (row?.type as ClinicType) ?? "CLINIC",
      address: (row?.address as string | null) ?? null,
      district: (row?.district as string | null) ?? null,
      roles: m.roles,
    };
  });

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Where you practise"
        subtitle="Add every chamber, clinic or hospital you work from. Your patient records stay with you across all of them."
      />

      <SectionCard className="overflow-hidden">
        <SectionHeader
          title="Your places"
          count={clinics.length}
          icon={<Building2 className="size-4" />}
        />

        <ul className="divide-y divide-hairline">
          {clinics.map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
              <span
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"
                aria-hidden="true"
              >
                {TYPE_ICON[c.type]}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {c.name}
                  {c.id === activeId ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-[#07684a]">
                      <Check className="size-3" aria-hidden="true" />
                      Working here now
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {TYPE_LABEL[c.type]}
                  {c.roles.length
                    ? ` · ${c.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")}`
                    : ""}
                </p>
                {c.address || c.district ? (
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {[c.address, c.district].filter(Boolean).join(", ")}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        <AddClinicForm />
      </SectionCard>

      <p className="text-xs text-ink-muted">
        Switching between places changes your schedule, queue and staff — not
        your patient records. A patient you see at two of these is one record
        with one timeline.
      </p>
    </div>
  );
}
