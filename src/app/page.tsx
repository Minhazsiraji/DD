import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";

const benefits = [
  {
    title: "Move faster",
    body: "Keep the consultation focused. Patient context, structured notes and prescription workflow live in one place.",
  },
  {
    title: "Remember the patient",
    body: "Return visits keep previous consultations, prescriptions and investigations available without overwriting today.",
  },
  {
    title: "Finish safely",
    body: "Review first. Finalized prescriptions are controlled, auditable and protected from silent historical changes.",
  },
];

const workflow = [
  "Find or create patient",
  "Review previous context",
  "Consult with less typing",
  "Prepare prescription",
  "Review and finalize",
  "Print and remember next time",
];

export default function RootPage() {
  return (
    <MarketingShell>
      <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:pb-28 lg:pt-24">
        <div className="self-center">
          <p className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-medium text-teal-800">
            Built around the doctor, not the data-entry screen
          </p>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
            Less screen.
            <br />
            More patient.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Doctor&apos;s Diary is a doctor productivity workspace for patient history,
            consultations, prescriptions, chambers and follow-up — designed to reduce
            repetitive work instead of adding more forms.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700">
              Start free
            </Link>
            <Link href="/pricing" className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">
              See founding plan
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            No public “verified doctor” claim is made until credential verification is actually available.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-[2rem] border border-white/90 bg-white/30 p-5 shadow-[0_30px_90px_rgba(46,104,170,0.18),inset_0_1px_0_rgba(255,255,255,1)] backdrop-blur-2xl sm:p-7 animate-in fade-in zoom-in-95 duration-1000 [animation-delay:250ms] [animation-fill-mode:both]">
          <div className="relative overflow-hidden rounded-3xl border border-white/80 bg-gradient-to-br from-white/55 via-sky-50/35 to-cyan-100/25 p-6 shadow-[0_18px_55px_rgba(60,113,170,0.13),inset_0_1px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(164,214,255,0.45)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Today</p>
                <p className="mt-1 text-xl font-semibold">Doctor workspace</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-teal-700">Private clinical workspace</span>
            </div>
            <div className="mt-6 grid gap-3">
              {workflow.map((item, i) => (
                <div key={item} className="animate-in fade-in slide-in-from-top-4 duration-700 [animation-fill-mode:both] flex items-center gap-3 rounded-2xl border border-white/90 bg-white/42 px-4 py-3 text-sm text-slate-700 backdrop-blur-md shadow-[0_10px_28px_rgba(58,106,160,0.10),inset_0_1px_0_rgba(255,255,255,1)]" style={{ animationDelay: `${700 + i * 180}ms` }}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-teal-50 font-semibold text-teal-700">{i + 1}</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-5 px-5 py-16 md:grid-cols-3 lg:px-8">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="rounded-3xl border border-slate-200 bg-[#fbfdff] p-6">
              <h2 className="text-lg font-semibold">{benefit.title}</h2>
              <p className="mt-3 leading-7 text-slate-600">{benefit.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="rounded-[2rem] bg-slate-950 px-6 py-10 text-white sm:px-10 lg:flex lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-300">Founding doctors</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Help shape the workflow before the wider launch.</h2>
            <p className="mt-3 max-w-2xl text-slate-300">
              Early doctors get high-touch onboarding and an early-user commercial plan. Exact pricing remains configurable until pilot evidence is complete.
            </p>
          </div>
          <Link href="/pricing" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 lg:mt-0">
            View the plan
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
