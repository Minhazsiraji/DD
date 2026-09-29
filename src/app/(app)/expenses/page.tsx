import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { deleteExpense, saveExpense } from "@/features/expenses/actions";
import { getDoctorExpenses, getExpenseChambers } from "@/features/expenses/queries";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const [expenses, chambers, search] = await Promise.all([getDoctorExpenses(), getExpenseChambers(), searchParams]);
  const names = new Map(chambers.map((c) => [c.locationId, c.locationName]));
  const error = typeof search.error === "string" ? search.error : null;
  return <div className="min-w-0 space-y-5 sm:space-y-6">
    <PageHeader eyebrow="Practice finances" title="Expenses" subtitle="Record Doctor practice costs by chamber. Platform billing is kept separate." />
    {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">Could not save that expense. Check the values and chamber access.</p>}
    <SectionCard className="p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-ink">Add expense</h2>
      <form action={saveExpense} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-semibold">Item<input name="name" required maxLength={120} className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" placeholder="Chamber Rent" /></label>
        <label className="text-sm font-semibold">Date<input name="date" type="date" required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" /></label>
        <label className="text-sm font-semibold">Amount (BDT)<input name="amount" type="number" min="0.01" step="0.01" required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" /></label>
        <label className="text-sm font-semibold">Chamber<select name="locationId" required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5"><option value="">Select</option>{chambers.map(c => <option key={c.locationId} value={c.locationId}>{c.locationName}</option>)}</select></label>
        <label className="text-sm font-semibold sm:col-span-2 lg:col-span-1">Purpose<input name="reason" maxLength={500} className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" /></label>
        <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white sm:col-span-2 lg:col-span-5">Add expense</button>
      </form>
    </SectionCard>
    <SectionCard className="overflow-hidden">
      <div className="border-b border-hairline px-4 py-3 sm:px-5"><h2 className="font-semibold text-ink">Expense ledger</h2></div>
      {expenses.length === 0 ? <p className="p-6 text-center text-sm text-ink-muted">No expenses recorded yet.</p> :
        <div className="divide-y divide-hairline">{expenses.map(e => <div key={e.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[1.3fr_1fr_1fr_1fr_auto] sm:items-center sm:px-5">
          <div><p className="font-semibold text-ink">{e.expenseName}</p><p className="text-ink-muted">{e.reason || "No purpose noted"}</p></div>
          <span>{e.expenseDate}</span><span>{names.get(e.practiceLocationId) || "Authorized chamber"}</span><strong className="tabular-nums">৳{e.amount}</strong>
          <div className="flex gap-2"><details><summary className="cursor-pointer rounded-lg border border-hairline px-3 py-2 font-semibold">Edit</summary><form action={saveExpense} className="mt-2 grid min-w-64 gap-2"><input type="hidden" name="id" value={e.id}/><input name="name" defaultValue={e.expenseName} required className="rounded-lg border px-2 py-1"/><input name="date" type="date" defaultValue={e.expenseDate} required className="rounded-lg border px-2 py-1"/><input name="amount" type="number" step="0.01" min="0.01" defaultValue={e.amount} required className="rounded-lg border px-2 py-1"/>
<select name="locationId" defaultValue={e.practiceLocationId} required className="rounded-lg border px-2 py-1">{chambers.map(c=><option key={c.locationId} value={c.locationId}>{c.locationName}</option>)}</select><input name="reason" defaultValue={e.reason || ""} className="rounded-lg border px-2 py-1"/><button className="rounded-lg bg-brand px-3 py-2 font-semibold text-white">Save</button></form></details>
          <form action={deleteExpense}><input type="hidden" name="id" value={e.id}/><button className="rounded-lg border border-hairline px-3 py-2 font-semibold text-red-700" title="Delete this expense">Delete</button></form></div>
        </div>)}</div>}
    </SectionCard>
  </div>;
}
