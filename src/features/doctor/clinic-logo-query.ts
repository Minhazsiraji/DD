import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, getMemberships } from "@/lib/auth/session";
import { serviceStorage } from "@/lib/supabase/service";

const CLINIC_LOGO_BUCKET = "clinic-assets";

export interface ClinicLogoSetting {
  locationId: string;
  locationName: string;
  logoPath: string | null;
  logoUrl: string | null;
}

export async function getClinicLogoSettings(): Promise<ClinicLogoSetting[]> {
  await requireUser();
  const memberships = (await getMemberships()).filter((m) => m.roles.includes("DOCTOR"));
  if (memberships.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("practice_locations")
    .select("id, name, prescription_logo_path")
    .in("id", memberships.map((m) => m.locationId));
  if (error) {
    console.error("[doctor] clinic logo settings read failed");
    return [];
  }

  const rows = new Map((data ?? []).map((row) => [row.id as string, row]));
  const storage = serviceStorage().from(CLINIC_LOGO_BUCKET);

  return Promise.all(
    memberships.map(async (membership) => {
      const row = rows.get(membership.locationId);
      const logoPath = (row?.prescription_logo_path as string | null) ?? null;
      let logoUrl: string | null = null;
      if (logoPath) {
        const signed = await storage.createSignedUrl(logoPath, 60 * 10);
        logoUrl = signed.error ? null : signed.data?.signedUrl ?? null;
      }
      return {
        locationId: membership.locationId,
        locationName: (row?.name as string) ?? membership.locationName,
        logoPath,
        logoUrl,
      };
    }),
  );
}
