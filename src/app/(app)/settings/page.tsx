import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Hospital, Video, Check, ShieldCheck, ChevronRight } from "lucide-react";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { AddLocationForm } from "@/features/locations/components/add-location-form";
import {
  requireUser,
  getMemberships,
  ACTIVE_LOCATION_COOKIE,
} from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

type LocationType = "PERSONAL_CHAMBER" | "CLINIC" | "HOSPITAL" | "TELEMEDICINE" | "OTHER";

const TYPE_ICON: Record<LocationType, React.ReactNode> = {
  PERSONAL_CHAMBER: <Building2 className="size-4" />,
  CLINIC: <Hospital className="size-4" />,
  HOSPITAL: <Hospital className="size-4" />,
  TELEMEDICINE: <Video className="size-4" />,
  OTHER: <Building2 className="size-4" />,
};

const TYPE_LABEL: Record<LocationType, string> = {
  PERSONAL_CHAMBER: "Own chamber",
  CLINIC: "Clinic",
  HOSPITAL: "Hospital",
  TELEMEDICINE: "Telemedicine",
  OTHER: "Other",
};

const ROLE_LABEL: Record<string, string> = {
  DOCTOR: "Doctor",
  RECEPTIONIST: "Reception",
  LOCATION_ADMIN: "Admin",
};

export default async function SettingsPage() {
  await requireUser();
  const memberships = await getMemberships();
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from("practice_locations")
    .select("id, name, type, address, district, phone")
    .in(
      "id",
      memberships.map((m) => m.locationId),
    );

  const cookieStore = await cookies();
  const activeId =
    cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value ?? memberships[0]?.locationId;

  const locations = memberships.map((m) => {
    const row = rows?.find((r) => r.id === m.locationId);
    return {
      id: m.locationId,
      name: m.locationName,
      type: (row?.type as LocationType) ?? "CLINIC",
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
          count={locations.length}
          icon={<Building2 className="size-4" />}
        />

        <ul className="divide-y divide-hairline">
          {locations.map((c) => (
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

        <AddLocationForm />
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader
          title="Account security"
          icon={<ShieldCheck className="size-4" />}
        />
        <div className="p-4 sm:p-5">
          <Link
            href="/settings/security"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
            Two-step verification &amp; devices
            <ChevronRight className="size-4 text-ink-muted" aria-hidden="true" />
          </Link>
          <p className="mt-2 text-xs text-ink-muted">
            Set up an authenticator on your phone, add a backup, and sign out
            devices you no longer use.
          </p>
        </div>
      </SectionCard>

      <p className="text-xs text-ink-muted">
        Switching between places changes your schedule, queue and staff — not
        your patient records. A patient you see at two of these is one record
        with one timeline.
      </p>
    </div>
  );
}





