import { NextResponse } from "next/server";
import { verifyAndReconcileProviderPayload } from "@/features/payments/gateway";
async function handle(request:Request){const body=request.method==="POST"?new URLSearchParams(await request.text()):new URL(request.url).searchParams; try{await verifyAndReconcileProviderPayload(body);}catch{} return NextResponse.redirect(new URL("/payments?gateway=returned",request.url),303)}
export const POST=handle; export const GET=handle;
