import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority } from "@/features/patients/m1-context";

export interface PracticePayment {
  id: string; practiceLocationId: string; paymentDate: string;
  grossAmount: string; paidAmount: string; refundedAmount: string;
  method: string; status: string; note: string | null;
}

export async function getPracticePayments(): Promise<PracticePayment[]> {
  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId) return [];
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from("practice_payments")
    .select("id,practice_location_id,payment_date,gross_amount,paid_amount,refunded_amount,method,status,note")
    .eq("owner_doctor_id", authority.doctorId).order("payment_date", { ascending: false });
  if (result.error) return [];
  return (result.data ?? []).map((row) => ({
    id: String(row.id), practiceLocationId: String(row.practice_location_id), paymentDate: String(row.payment_date),
    grossAmount: String(row.gross_amount), paidAmount: String(row.paid_amount), refundedAmount: String(row.refunded_amount),
    method: String(row.method), status: String(row.status), note: row.note ? String(row.note) : null,
  }));
}
