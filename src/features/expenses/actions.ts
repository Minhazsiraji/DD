"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority } from "@/features/patients/m1-context";

const expenseSchema = z.object({
  id: z.string().uuid().optional(),
  locationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().positive().max(100000000),
  reason: z.string().trim().max(500).optional(),
});

function parse(formData: FormData) {
  return expenseSchema.safeParse({ id: formData.get("id") || undefined, locationId: formData.get("locationId"),
    name: formData.get("name"), date: formData.get("date"), amount: formData.get("amount"), reason: formData.get("reason") || undefined });
}

export async function saveExpense(formData: FormData) {
  const parsed = parse(formData);
  if (!parsed.success) redirect("/expenses?error=check-values");
  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId) redirect("/expenses?error=doctor-required");
  const supabase = await createSupabaseServerClient();
  const v = parsed.data;
  const payload = { practice_location_id: v.locationId, expense_name: v.name, expense_date: v.date, amount: v.amount.toFixed(2), reason: v.reason || null };
  const result = v.id
    ? await supabase.from("doctor_expenses").update(payload).eq("id", v.id).eq("owner_doctor_id", authority.doctorId)
    : await supabase.from("doctor_expenses").insert({ ...payload, owner_doctor_id: authority.doctorId });
  if (result.error) redirect("/expenses?error=save-failed");
  revalidatePath("/expenses"); revalidatePath("/analytics");
  redirect("/expenses?saved=1");
}

export async function deleteExpense(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect("/expenses?error=delete-failed");
  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId) redirect("/expenses?error=doctor-required");
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from("doctor_expenses").delete().eq("id", id.data).eq("owner_doctor_id", authority.doctorId);
  if (result.error) redirect("/expenses?error=delete-failed");
  revalidatePath("/expenses"); revalidatePath("/analytics");
  redirect("/expenses?deleted=1");
}
