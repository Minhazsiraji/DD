import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Search, Stethoscope } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";

const benefits = [
  {
    title: "Move faster",
    body: "Keep patient context, structured notes and prescription workflow together without turning the visit into a long form.",
    icon: <Stethoscope className="size-5" aria-hidden="true" />,
  },
  {
    title: "Find context quickly",
    body: "Return visits surface previous consultations and prescriptions without overwriting today’s clinical record.",
    icon: <Search className="size-5" aria-hidden="true" />,
  },
  {
    title: "Finish safely",
    body: "Prescription drafts stay editable until the doctor explicitly reviews and finalizes them.",
    icon: <FileText className="size-5" aria-hidden="true" />,
  },
];

const workflow = [
  "Find or create patient",
  "Review previous context",
  "Consult with less typing",
  "Prepare prescription if needed",
  "Review and finalize",
  "Set follow-up and finish",
];

export default function RootPage() {
  return (
    <MarketingShell>
      <section className="mx-auto grid max-w-7xl gap-10 px-5 pb-16 pt-14 lg:grid-cols-[1.02fr_.98fr] lg:px-8 lg:pb-20 lg:pt-20">
        <div className="self-center">
          <p className="inline-flex rounded-full border border-white/75 bg-white/48 px-3 py-1.5 text-[12px] font-semibold text-[#5f52c5] shadow-[0_6px_16px_rgb(75_62_103/0.06),inset_0_1px_0_white]">
            Built around the doctor, not the data-entry screen
          </p>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-[#211c43] sm:text-6xl lg:text-[68px] lg:leading-[1.02]">
            Less screen.
            <br />
            More patient.
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-8 text-ink-secondary sm:text-lg">
            Doctor&apos;s Diary is a doctor productivity workspace for patient history,
            consultations, prescriptions, chambers and follow-up — designed to reduce
            repetitive work instead of adding more forms.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="liquid-primary inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white">
              Start free
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link href="/pricing" className="liquid-secondary inline-flex h-12 items-center rounded-full px-5 text-sm font-semibold text-[#40385f]">
              See founding plan
            </Link>
          </div>
          <p className="mt-4 text-[12.5px] leading-6 text-ink-muted">
            No public “verified doctor” claim is made until credential verification is actually available.
          </p>
        </div>

        <div className="liquid-landing-demo rounded-[30px] p-4 sm:p-5">
          <div className="liquid-landing-inner rounded-[24px] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#70698e]">Today</p>
                <p className="mt-1 text-[20px] font-semibold tracking-[-0.025em] text-[#2c2753]">Doctor workspace</p>
              </div>
              <span className="liquid-chip inline-flex rounded-full px-3 py-1.5 text-[11px] font-semibold text-[#5f52c5]">
                Private clinical workspace
              </span>
            </div>
            <div className="mt-6 grid gap-3">
              {workflow.map((item, i) => (
                <div key={item} className="liquid-workflow-row flex items-center gap-3 rounded-[18px] px-4 py-3.5 text-[13.5px] font-medium text-[#48425f]">
                  <span className="liquid-step grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-[#6554d0]">{i + 1}</span>
                  <span className="min-w-0 flex-1">{item}</span>
                  <CheckCircle2 className="size-4 shrink-0 text-[#72cdbb]" aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
        <div className="grid gap-4 md:grid-cols-3">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="liquid-public-card rounded-[24px] p-5 sm:p-6">
              <span className="liquid-feature-icon inline-flex size-10 items-center justify-center rounded-[14px] text-[#6655cf]">
                {benefit.icon}
              </span>
              <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-[#302a59]">{benefit.title}</h2>
              <p className="mt-2 text-[13.5px] leading-6 text-ink-secondary">{benefit.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
        <div className="liquid-public-cta rounded-[30px] px-6 py-8 sm:px-8 lg:flex lg:items-center lg:justify-between lg:px-10">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6554d0]">Founding doctors</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[#2b254f]">Help shape the workflow before wider launch.</h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-7 text-ink-secondary">
              Early doctors get high-touch onboarding and an early-user commercial plan while pilot evidence is completed.
            </p>
          </div>
          <Link href="/pricing" className="liquid-secondary mt-6 inline-flex h-11 items-center rounded-full px-5 text-[13px] font-semibold text-[#40385f] lg:mt-0">
            View the plan
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
