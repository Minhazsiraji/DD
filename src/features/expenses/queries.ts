import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority } from "@/features/patients/m1-context";

export interface ExpenseChamber { locationId: string; locationName: string; timezone: string }
export interface DoctorExpense {
  id: string; practiceLocationId: string; expenseName: string; expenseDate: string;
  amount: string; reason: string | null; createdAt: string; updatedAt: string;
}

export async function getExpenseChambers(): Promise<ExpenseChamber[]> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc("doctor_expense_chambers");
  if (result.error || !Array.isArray(result.data)) return [];
  return result.data as unknown as ExpenseChamber[];
}

export async function getDoctorExpenses(): Promise<DoctorExpense[]> {
  const authority = await getM1DoctorAuthority();
  if (!authority.canClinical || !authority.doctorId) return [];
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from("doctor_expenses")
    .select("id,practice_location_id,expense_name,expense_date,amount,reason,created_at,updated_at")
    .eq("owner_doctor_id", authority.doctorId).order("expense_date", { ascending: false });
  if (result.error) return [];
  return (result.data ?? []).map((row) => ({
    id: String(row.id), practiceLocationId: String(row.practice_location_id), expenseName: String(row.expense_name),
    expenseDate: String(row.expense_date), amount: String(row.amount), reason: row.reason ? String(row.reason) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}
