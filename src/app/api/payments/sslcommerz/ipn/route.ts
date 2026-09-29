import { NextResponse } from "next/server";
import { verifyAndReconcileProviderPayload } from "@/features/payments/gateway";
export async function POST(request:Request){const body=new URLSearchParams(await request.text()); try{const result=await verifyAndReconcileProviderPayload(body); return NextResponse.json({received:true,reconciled:result==="PAID"});}catch{return NextResponse.json({received:true,reconciled:false},{status:202});}}
