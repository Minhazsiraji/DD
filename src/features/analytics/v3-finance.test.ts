import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const read=(file:string)=>readFileSync(path.resolve(file),"utf8");

describe("Analytics practice finance and scope contract",()=>{
  it("derives Income from practice payments, Cost from expenses, and excludes SaaS billing",()=>{
    const source=read("src/features/analytics/doctor-analytics.ts");
    expect(source).toContain('.from("doctor_expenses")');
    expect(source).toContain('.from("practice_payments")');
    expect(source).not.toMatch(/subscription_payments|owner_activity_cost|ai_usage/iu);
    expect(source).toContain("paid_amount"); expect(source).toContain("refunded_amount");
  });
  it("resolves an authorized chamber set before all-chambers reads",()=>{
    const source=read("src/features/analytics/doctor-analytics.ts");
    expect(source).toContain('supabase.rpc("doctor_expense_chambers")');
    expect(source).toContain('.in("practice_location_id", locationIds)');
  });
  it("provides four equal authoritative KPI cards",()=>{
    const view=read("src/features/analytics/components/analytics-dashboard.tsx");
    expect(view).toContain("md:grid-cols-2 lg:grid-cols-4");
    for (const label of ["Patient encounters","Income","Cost","Net income"]) expect(view).toContain(`label="${label}"`);
    expect(view).toContain("data.financials.income");
    expect(view).toContain("data.financials.cost");
    expect(view).toContain("data.financials.netIncome");
  });
});
