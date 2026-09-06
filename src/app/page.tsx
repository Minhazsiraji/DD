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
          <p className="dd-material-record dd-record-pearl inline-flex rounded-full px-3 py-1 text-sm font-medium text-brand">
            Built around the doctor, not the data-entry screen
          </p>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-tight text-brand sm:text-6xl">
            Less screen.
            <br />
            <span className="dd-brand-teal">More patient.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink-secondary">
            Doctor&apos;s Diary is a doctor productivity workspace for patient history,
            consultations, prescriptions, chambers and follow-up — designed to reduce
            repetitive work instead of adding more forms.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="dd-primary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring">
              Start free
            </Link>
            <Link href="/pricing" className="dd-secondary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring">
              See founding plan
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            No public “verified doctor” claim is made until credential verification is actually available.
          </p>
        </div>

        <div className="dd-app-panel dd-material-panel dd-panel-pearl dd-public-card p-5 sm:p-7">
          <div className="rounded-3xl bg-white/10 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">Today</p>
                <p className="mt-1 text-xl font-semibold">Doctor workspace</p>
              </div>
              <span className="dd-material-record dd-record-pearl rounded-full px-3 py-1 text-xs font-medium text-brand">Private clinical workspace</span>
            </div>
            <div className="mt-6 grid gap-3">
              {workflow.map((item, i) => (
                <div key={item} className="dd-quick-row dd-quick-control flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold focus-visible:focus-ring">
                  <span className="grid size-4 shrink-0 place-items-center text-[11px] font-bold text-brand">{i + 1}</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-white/45">
        <div className="mx-auto grid max-w-7xl gap-5 px-5 py-16 md:grid-cols-3 lg:px-8">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="dd-material-record dd-record-pearl dd-public-feature-card p-6">
              <h2 className="text-lg font-semibold">{benefit.title}</h2>
              <p className="mt-3 leading-7 text-ink-secondary">{benefit.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="dd-material-panel dd-panel-pearl rounded-[2rem] px-6 py-10 text-ink sm:px-10 lg:flex lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">Founding doctors</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Help shape the workflow before the wider launch.</h2>
            <p className="mt-3 max-w-2xl text-ink-secondary">
              Early doctors get high-touch onboarding and an early-user commercial plan. Exact pricing remains configurable until pilot evidence is complete.
            </p>
          </div>
          <Link href="/pricing" className="dd-secondary mt-6 inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring lg:mt-0">
            View the plan
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
