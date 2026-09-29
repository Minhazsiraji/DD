import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority } from "@/features/patients/m1-context";
import { practiceGatewayConfigured } from "./gateway";
type SettingsRow={cash_enabled?:boolean;online_payment_enabled?:boolean;bangla_qr_status?:string};
export async function getPaymentSettings(){const authority=await getM1DoctorAuthority(); if(!authority.canClinical||!authority.doctorId)return null; const supabase=await createSupabaseServerClient(); // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const client=supabase as unknown as {from:(table:string)=>any}; const result=await client.from("doctor_payment_settings").select("cash_enabled,online_payment_enabled,bangla_qr_status").eq("owner_doctor_id",authority.doctorId).maybeSingle(); const row=(result.data??{}) as SettingsRow; return {cashEnabled:row.cash_enabled??true,onlinePaymentEnabled:row.online_payment_enabled??false,configured:practiceGatewayConfigured(),banglaQrStatus:row.bangla_qr_status??"MERCHANT_ACTIVATION_REQUIRED"};}
