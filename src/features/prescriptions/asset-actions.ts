"use server";

import { z } from "zod";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serviceStorage } from "@/lib/supabase/service";

/**
 * Short-lived URL for the exact clinic/chamber logo attested by this prescription.
 * The browser supplies only the prescription id. The database resolves the path
 * after checking the caller may read/hand over the prescription, so no client can
 * point this action at an arbitrary clinic asset.
 */
export async function frozenClinicLogoUrlAction(
  prescriptionId: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const parsed = z.uuid().safeParse(prescriptionId);
  if (!parsed.success) return { ok: false };

  await requireLocationContext();
  const supabase = await createSupabaseServerClient();
  const { data: path, error: pathError } = await supabase.rpc(
    "prescription_clinic_logo_asset_path",
    { p_prescription_id: parsed.data },
  );
  if (pathError || typeof path !== "string" || path === "") return { ok: false };

  const { data, error } = await serviceStorage()
    .from("clinic-assets")
    .createSignedUrl(path, 120);

  if (error || !data?.signedUrl) return { ok: false };
  return { ok: true, url: data.signedUrl };
}
