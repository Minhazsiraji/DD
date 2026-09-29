import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { getExpenseChambers } from "@/features/expenses/queries";
import { deletePracticePayment, savePracticePayment } from "@/features/payments/actions";
import { getPracticePayments } from "@/features/payments/queries";

export const metadata: Metadata = { title: "Payments" };
const methods = ["CASH","BKASH","NAGAD","BANGLAQR","CARD","BANK","OTHER"] as const;
const statuses = ["PAID","PARTIAL","UNPAID","REFUNDED","WAIVED"] as const;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const [payments, chambers, search] = await Promise.all([getPracticePayments(), getExpenseChambers(), searchParams]);
  const names = new Map(chambers.map(c => [c.locationId, c.locationName]));
  const error = typeof search.error === "string" ? search.error : null;
  return <div className="min-w-0 space-y-5 sm:space-y-6">
    <PageHeader eyebrow="Practice finances" title="Payments" subtitle="Record patient/practice revenue. Doctor’s Diary subscription billing stays separate." />
    {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">Could not save that payment. Check amounts and chamber access.</p>}
    <SectionCard className="p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-ink">Add payment</h2>
      <form action={savePracticePayment} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold">Date<input name="date" type="date" required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" /></label>
        <label className="text-sm font-semibold">Chamber<select name="locationId" required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5"><option value="">Select</option>{chambers.map(c=><option key={c.locationId} value={c.locationId}>{c.locationName}</option>)}</select></label>
        <label className="text-sm font-semibold">Fee / gross (BDT)<input name="gross" type="number" min="0" step="0.01" required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" /></label>
        <label className="text-sm font-semibold">Paid (BDT)<input name="paid" type="number" min="0" step="0.01" required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" /></label>
        <label className="text-sm font-semibold">Refund (BDT)<input name="refund" type="number" min="0" step="0.01" defaultValue="0" className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" /></label>
        <label className="text-sm font-semibold">Method<select name="method" defaultValue="CASH" className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5">{methods.map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="text-sm font-semibold">Status<select name="status" defaultValue="PAID" className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5">{statuses.map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="text-sm font-semibold">Note<input name="note" maxLength={500} className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" /></label>
        <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white sm:col-span-2 lg:col-span-4">Add payment</button>
      </form>
    </SectionCard>
    <SectionCard className="overflow-hidden">
      <div className="border-b border-hairline px-4 py-3 sm:px-5"><h2 className="font-semibold text-ink">Practice payment ledger</h2></div>
      {payments.length === 0 ? <p className="p-6 text-center text-sm text-ink-muted">No practice payments recorded yet.</p> : <div className="divide-y divide-hairline">{payments.map(p => {
        const net = (Number(p.paidAmount)-Number(p.refundedAmount)).toFixed(2);
        return <div key={p.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-center sm:px-5">
          <div><p className="font-semibold text-ink">৳{net} received</p><p className="text-ink-muted">{p.status} · {p.method}</p></div>
          <span>{p.paymentDate}</span><span>{names.get(p.practiceLocationId)||"Authorized chamber"}</span><span className="tabular-nums">Fee ৳{p.grossAmount}</span>
          <div className="flex gap-2"><details><summary className="cursor-pointer rounded-lg border border-hairline px-3 py-2 font-semibold">Edit</summary><form action={savePracticePayment} className="mt-2 grid min-w-64 gap-2">
            <input type="hidden" name="id" value={p.id}/><input name="date" type="date" defaultValue={p.paymentDate} required className="rounded-lg border px-2 py-1"/>
            <select name="locationId" defaultValue={p.practiceLocationId} required className="rounded-lg border px-2 py-1">{chambers.map(c=><option key={c.locationId} value={c.locationId}>{c.locationName}</option>)}</select>
            <input name="gross" type="number" min="0" step="0.01" defaultValue={p.grossAmount} required className="rounded-lg border px-2 py-1"/><input name="paid" type="number" min="0" step="0.01" defaultValue={p.paidAmount} required className="rounded-lg border px-2 py-1"/>
            <input name="refund" type="number" min="0" step="0.01" defaultValue={p.refundedAmount} required className="rounded-lg border px-2 py-1"/><select name="method" defaultValue={p.method} className="rounded-lg border px-2 py-1">{methods.map(v=><option key={v}>{v}</option>)}</select>
            <select name="status" defaultValue={p.status} className="rounded-lg border px-2 py-1">{statuses.map(v=><option key={v}>{v}</option>)}</select><input name="note" defaultValue={p.note||""} className="rounded-lg border px-2 py-1"/><button className="rounded-lg bg-brand px-3 py-2 font-semibold text-white">Save</button>
          </form></details><form action={deletePracticePayment}><input type="hidden" name="id" value={p.id}/><button className="rounded-lg border border-hairline px-3 py-2 font-semibold text-red-700">Delete</button></form></div>
        </div>;
      })}</div>}
    </SectionCard>
  </div>;
}
