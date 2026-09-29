"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority } from "@/features/patients/m1-context";

const schema = z.object({
  id: z.string().uuid().optional(), locationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), gross: z.coerce.number().min(0).max(100000000),
  paid: z.coerce.number().min(0).max(100000000), refund: z.coerce.number().min(0).max(100000000),
  method: z.enum(["CASH","BKASH","NAGAD","BANGLAQR","CARD","BANK","OTHER"]),
  status: z.enum(["UNPAID","PARTIAL","PAID","REFUNDED","WAIVED"]), note: z.string().trim().max(500).optional(),
}).refine(v => v.refund <= v.paid, { message: "refund" });

function parse(fd: FormData) { return schema.safeParse({
  id: fd.get("id") || undefined, locationId: fd.get("locationId"), date: fd.get("date"), gross: fd.get("gross"),
  paid: fd.get("paid"), refund: fd.get("refund") || 0, method: fd.get("method"), status: fd.get("status"), note: fd.get("note") || undefined,
}); }

export async function savePracticePayment(fd: FormData) {
  const parsed = parse(fd); if (!parsed.success) redirect("/payments?error=check-values");
  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId) redirect("/payments?error=doctor-required");
  const supabase = await createSupabaseServerClient(); const v = parsed.data;
  const payload = { practice_location_id: v.locationId, payment_date: v.date, gross_amount: v.gross.toFixed(2),
    paid_amount: v.paid.toFixed(2), refunded_amount: v.refund.toFixed(2), method: v.method, status: v.status, note: v.note || null };
  const result = v.id
    ? await supabase.from("practice_payments").update(payload).eq("id", v.id).eq("owner_doctor_id", authority.doctorId)
    : await supabase.from("practice_payments").insert({ ...payload, owner_doctor_id: authority.doctorId });
  if (result.error) redirect("/payments?error=save-failed");
  revalidatePath("/payments"); revalidatePath("/analytics"); redirect("/payments?saved=1");
}

export async function deletePracticePayment(fd: FormData) {
  const id = z.string().uuid().safeParse(fd.get("id")); if (!id.success) redirect("/payments?error=delete-failed");
  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId) redirect("/payments?error=doctor-required");
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from("practice_payments").delete().eq("id", id.data).eq("owner_doctor_id", authority.doctorId);
  if (result.error) redirect("/payments?error=delete-failed");
  revalidatePath("/payments"); revalidatePath("/analytics"); redirect("/payments?deleted=1");
}
