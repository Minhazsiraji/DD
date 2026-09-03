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
      <section className="mx-auto grid max-w-7xl gap-7 px-4 pb-12 pt-10 sm:gap-8 sm:px-5 sm:pb-16 sm:pt-14 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:px-7 lg:pb-18 lg:pt-16">
        <div className="self-center">
          <p className="dd-chip inline-flex max-w-full rounded-full px-3 py-1.5 text-[11px] leading-4 font-semibold text-[#5f52c5] sm:text-[12px]">
            Built around the doctor, not the data-entry screen
          </p>
          <h1 className="mt-5 max-w-3xl text-[42px] leading-[.98] font-semibold tracking-[-0.045em] text-[#211c43] sm:text-[54px] lg:text-[62px] lg:leading-[1]">
            Less screen.
            <br />
            More patient.
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-7 text-ink-secondary sm:text-[17px] sm:leading-7 lg:max-w-xl">
            Doctor&apos;s Diary is a doctor productivity workspace for patient history,
            consultations, prescriptions, chambers and follow-up — designed to reduce
            repetitive work instead of adding more forms.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5 sm:gap-3">
            <Link href="/signup" className="dd-primary inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold text-white sm:h-12 sm:px-5 sm:text-sm">
              Start free
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link href="/pricing" className="dd-secondary inline-flex h-11 items-center whitespace-nowrap rounded-full px-4 text-[13px] font-semibold text-ink-secondary sm:h-12 sm:px-5 sm:text-sm">
              See founding plan
            </Link>
          </div>
          <p className="mt-4 max-w-xl text-[11.5px] leading-5 text-ink-muted sm:text-[12px]">
            No public “verified doctor” claim is made until credential verification is actually available.
          </p>
        </div>

        <div className="dd-landing-demo p-3 sm:p-4">
          <div className="dd-landing-inner rounded-[22px] p-4 sm:rounded-[24px] sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#70698e] sm:text-[11px]">Today</p>
                <p className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-[#2c2753] sm:text-[20px]">Doctor workspace</p>
              </div>
              <span className="dd-chip inline-flex rounded-full px-2.5 py-1.5 text-[10.5px] font-semibold text-[#5f52c5] sm:px-3 sm:text-[11px]">
                Private clinical workspace
              </span>
            </div>
            <div className="mt-4 grid gap-2.5 sm:mt-5 sm:gap-3">
              {workflow.map((item, i) => (
                <div key={item} className="dd-workflow-row flex min-h-[48px] items-center gap-3 rounded-[16px] px-3.5 py-3 text-[12.5px] font-medium text-[#48425f] sm:min-h-[52px] sm:rounded-[18px] sm:px-4 sm:text-[13.5px]">
                  <span className="dd-step grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-[#6554d0] sm:size-8 sm:text-[12px]">{i + 1}</span>
                  <span className="min-w-0 flex-1">{item}</span>
                  <CheckCircle2 className="size-4 shrink-0 text-[#72cdbb]" aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-7 sm:px-5 sm:py-8 lg:px-7 lg:py-9">
        <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="dd-public-card p-4.5 sm:p-5">
              <span className="dd-feature-icon inline-flex size-9 items-center justify-center rounded-[13px] text-[#6655cf] sm:size-10 sm:rounded-[14px]">
                {benefit.icon}
              </span>
              <h2 className="mt-3.5 text-[16px] font-semibold tracking-[-0.02em] text-[#302a59] sm:text-[17px]">{benefit.title}</h2>
              <p className="mt-1.5 text-[13px] leading-5.5 text-ink-secondary sm:text-[13.5px] sm:leading-6">{benefit.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-5 sm:py-12 lg:px-7 lg:py-14">
        <div className="dd-public-cta px-5 py-6 sm:px-7 sm:py-7 lg:flex lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#6554d0]">Founding doctors</p>
            <h2 className="mt-2.5 text-[26px] leading-tight font-semibold tracking-[-0.035em] text-[#2b254f] sm:text-3xl">Help shape the workflow before wider launch.</h2>
            <p className="mt-2.5 max-w-2xl text-[13.5px] leading-6 text-ink-secondary sm:text-[14px]">
              Early doctors get high-touch onboarding and an early-user commercial plan while pilot evidence is completed.
            </p>
          </div>
          <Link href="/pricing" className="dd-secondary mt-5 inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-[12.5px] font-semibold text-ink-secondary lg:mt-0">
            View the plan
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
