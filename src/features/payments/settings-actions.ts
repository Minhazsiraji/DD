"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority } from "@/features/patients/m1-context";
export async function savePaymentSettings(fd:FormData){const authority=await getM1DoctorAuthority(); if(!authority.canClinical||!authority.doctorId)redirect("/settings/payments?error=doctor-required"); const supabase=await createSupabaseServerClient(); // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const client=supabase as unknown as {from:(table:string)=>any}; const result=await client.from("doctor_payment_settings").upsert({owner_doctor_id:authority.doctorId,cash_enabled:fd.get("cashEnabled")==="on",online_payment_enabled:fd.get("onlinePaymentEnabled")==="on",provider:"SSLCOMMERZ",environment:"SANDBOX",updated_at:new Date().toISOString()},{onConflict:"owner_doctor_id"}); if(result.error)redirect("/settings/payments?error=save-failed"); revalidatePath("/settings/payments"); redirect("/settings/payments?saved=1");}
