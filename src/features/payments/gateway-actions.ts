"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { initiatePracticePayment } from "./gateway";

const schema=z.object({locationId:z.string().uuid(),amount:z.coerce.number().positive().max(100000000),customerName:z.string().trim().min(1).max(120),customerEmail:z.string().email().max(254),customerPhone:z.string().trim().min(7).max(30)});
export async function startOnlinePracticePayment(fd:FormData){
 const parsed=schema.safeParse(Object.fromEntries(fd)); if(!parsed.success) redirect("/payments?gatewayError=check-values"); const h=await headers(); const host=h.get("x-forwarded-host")??h.get("host"), proto=h.get("x-forwarded-proto")??"https"; if(!host) redirect("/payments?gatewayError=origin");
 try{const url=await initiatePracticePayment({...parsed.data,origin:`${proto}://${host}`}); redirect(url);}catch(error){if(error instanceof Error&&error.message==="NEXT_REDIRECT") throw error; redirect("/payments?gatewayError=unavailable");}
}
