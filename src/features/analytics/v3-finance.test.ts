import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const read=(file:string)=>readFileSync(path.resolve(file),"utf8");

describe("Analytics V3 finance and scope contract",()=>{
  it("uses Doctor expenses as Cost and keeps SaaS payments out of practice Income",()=>{
    const source=read("src/features/analytics/doctor-analytics.ts");
    expect(source).toContain('.from("doctor_expenses")');
    expect(source).not.toMatch(/subscription_payments|owner_activity_cost|ai_usage/iu);
    expect(source).toContain('income: null');
    expect(source).toContain('netIncome: null');
  });
  it("resolves an authorized chamber set before all-chambers reads",()=>{
    const source=read("src/features/analytics/doctor-analytics.ts");
    expect(source).toContain('supabase.rpc("doctor_expense_chambers")');
    expect(source).toContain('.in("practice_location_id", locationIds)');
  });
  it("provides four equal KPI cards with authoritative Cost",()=>{
    const view=read("src/features/analytics/components/analytics-dashboard.tsx");
    expect(view).toContain("md:grid-cols-2 lg:grid-cols-4");
    expect(view).toContain('<StatCard label="Patient encounters"');
    expect(view).toContain('<StatCard label="Income" value="—"');
    expect(view).toContain('<StatCard label="Cost" value={`৳${data.financials.cost}`}');
    expect(view).toContain('<StatCard label="Net income" value="—"');
  });
});
