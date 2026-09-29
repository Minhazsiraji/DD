import { describe,expect,it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const root=process.cwd(); const sql=fs.readFileSync(path.join(root,"supabase/policies/0055_practice_payment_gateway.sql"),"utf8"); const actions=fs.readFileSync(path.join(root,"src/features/payments/actions.ts"),"utf8"); const success=fs.readFileSync(path.join(root,"src/app/api/payments/sslcommerz/success/route.ts"),"utf8");
describe("practice gateway trust boundary",()=>{
 it("keeps manual trusted entry cash-only",()=>{expect(actions).toContain('z.literal("CASH")'); expect(actions).not.toContain('z.enum(["CASH","BKASH"')});
 it("requires server validation before success reconciliation",()=>{expect(success).toContain("verifyAndReconcileProviderPayload"); expect(success).not.toContain("practice_payments")});
 it("locks transaction row and makes reconciliation idempotent",()=>{expect(sql).toMatch(/for update/i); expect(sql).toMatch(/practice_payment_id uuid unique/i); expect(sql).toMatch(/merchant_transaction_id text not null unique/i); expect(sql).toMatch(/if tx\.status='PAID'/i)});
 it("rejects wrong amount/currency in the database authority",()=>{expect(sql).toMatch(/tx\.amount<>target_amount/); expect(sql).toMatch(/target_currency<>'BDT'/)});
 it("isolates doctor rows with RLS and keeps callbacks service-only",()=>{expect(sql).toMatch(/enable row level security/); expect(sql).toMatch(/resolve_doctor_profile_id_for_actor\(auth\.uid\(\)\)/); expect(sql).toMatch(/revoke all on function public\.reconcile_practice_gateway_payment[\s\S]*authenticated/); expect(sql).toMatch(/grant execute on function public\.reconcile_practice_gateway_payment[\s\S]*service_role/)});
 it("does not mix DD subscription accounting into reconciliation",()=>{const fn=sql.slice(sql.indexOf("reconcile_practice_gateway_payment")); expect(fn).toContain("practice_payments"); expect(fn).not.toContain("subscription_payments")});
});
