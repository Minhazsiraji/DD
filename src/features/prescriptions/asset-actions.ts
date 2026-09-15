"use server";

import { z } from "zod";
import { requireLocationContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signedClinicLogoObjectUrl } from "./freeze-store";

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

  const url = await signedClinicLogoObjectUrl(path, 120);
  return url ? { ok: true, url } : { ok: false };
}
