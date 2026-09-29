import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getM1DoctorAuthority } from "@/features/patients/m1-context";
import { createPayment, sslCommerzConfig, validatePayment } from "./sslcommerz";
import { serviceReconcilePracticeGatewayPayment, serviceTransitionPracticeGatewayPayment } from "@/lib/supabase/service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient={from:(table:string)=>any};
export { serviceTransitionPracticeGatewayPayment as transitionPracticeGatewayPayment };
export function practiceGatewayConfigured():boolean{return Boolean(sslCommerzConfig());}
export function gatewayTransactionId():string{return `DDP-${Date.now()}-${randomUUID().replaceAll("-","").slice(0,12)}`;}

export async function initiatePracticePayment(input:{locationId:string;amount:number;origin:string;customerName:string;customerEmail:string;customerPhone:string}):Promise<string>{
 const authority=await getM1DoctorAuthority(); if(!authority.canClinical||!authority.doctorId) throw new Error("DOCTOR_REQUIRED"); if(!practiceGatewayConfigured()) throw new Error("SSLCOMMERZ_PRACTICE_SANDBOX_NOT_CONFIGURED");
 const supabase=await createSupabaseServerClient(); const loose=supabase as unknown as LooseClient; const settings=await loose.from("doctor_payment_settings").select("online_payment_enabled").eq("owner_doctor_id",authority.doctorId).maybeSingle(); if(settings.error||!settings.data?.online_payment_enabled) throw new Error("ONLINE_PAYMENT_DISABLED"); const chamber=await supabase.from("practice_locations").select("id").eq("id",input.locationId).eq("owner_doctor_id",authority.doctorId).maybeSingle(); if(chamber.error||!chamber.data) throw new Error("CHAMBER_NOT_AUTHORIZED");
 const amount=input.amount.toFixed(2), merchantTransactionId=gatewayTransactionId();
 const created=await loose.from("practice_payment_transactions").insert({owner_doctor_id:authority.doctorId,practice_location_id:input.locationId,provider:"SSLCOMMERZ",merchant_transaction_id:merchantTransactionId,amount,currency:"BDT",status:"PENDING"}).select("id").single();
 if(created.error||!created.data) throw new Error("GATEWAY_TRANSACTION_CREATE_FAILED"); const base=input.origin.replace(/\/$/,"");
 try { const session=await createPayment({transactionId:merchantTransactionId,amount,currency:"BDT",successUrl:`${base}/api/payments/sslcommerz/success`,failUrl:`${base}/api/payments/sslcommerz/fail`,cancelUrl:`${base}/api/payments/sslcommerz/cancel`,ipnUrl:`${base}/api/payments/sslcommerz/ipn`,customerName:input.customerName,customerEmail:input.customerEmail,customerPhone:input.customerPhone,productName:"Doctor consultation"}); return session.gatewayPageUrl; }
 catch(error){await serviceTransitionPracticeGatewayPayment(merchantTransactionId,"FAILED"); throw error;}
}

export async function verifyAndReconcileProviderPayload(payload:URLSearchParams):Promise<"PAID"|"IGNORED">{
 const validationId=payload.get("val_id")?.trim(), postedTransactionId=payload.get("tran_id")?.trim(); if(!validationId||!postedTransactionId) return "IGNORED";
 const v=await validatePayment(validationId); if(!v.ok||v.transactionId!==postedTransactionId||!v.amount||String(v.currency??"").toUpperCase()!=="BDT") return "IGNORED";
 const result=await serviceReconcilePracticeGatewayPayment({merchantTransactionId:postedTransactionId,providerTransactionId:v.providerTransactionId,amount:v.amount,currency:"BDT",paymentChannel:v.cardType});
 return result.status==="PAID"?"PAID":"IGNORED";
}
