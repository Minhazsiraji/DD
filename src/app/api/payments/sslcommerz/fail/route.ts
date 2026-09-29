import { NextResponse } from "next/server";
import { transitionPracticeGatewayPayment } from "@/features/payments/gateway";
async function handle(request:Request){const body=request.method==="POST"?new URLSearchParams(await request.text()):new URL(request.url).searchParams,id=body.get("tran_id"); if(id){try{await transitionPracticeGatewayPayment(id,"FAILED")}catch{}} return NextResponse.redirect(new URL("/payments?gateway=failed",request.url),303)}
export const POST=handle; export const GET=handle;
