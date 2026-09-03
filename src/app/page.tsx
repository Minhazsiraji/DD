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
      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-10 pt-8 sm:gap-8 sm:px-5 sm:pb-14 sm:pt-11 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:px-7 lg:pb-16 lg:pt-14">
        <div className="self-center">
          <p className="dd-chip inline-flex max-w-full rounded-full px-3 py-1.5 text-[10.5px] leading-4 font-semibold text-[#5f52c5] sm:text-[11.5px]">
            Built around the doctor, not the data-entry screen
          </p>
          <h1 className="mt-4 max-w-3xl text-[38px] leading-[1] font-semibold tracking-[-0.043em] text-[#211c43] sm:text-[50px] lg:text-[58px]">
            Less screen.
            <br />
            More patient.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-6.5 text-ink-secondary sm:text-[16.5px] sm:leading-7 lg:max-w-xl">
            Doctor&apos;s Diary is a doctor productivity workspace for patient history,
            consultations, prescriptions, chambers and follow-up — designed to reduce
            repetitive work instead of adding more forms.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/signup"
              className="dd-primary dd-primary-arrow inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full pl-4 text-[12.5px] font-semibold text-white sm:h-11 sm:pl-5 sm:text-[13px]"
            >
              Start free
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
            <Link
              href="/pricing"
              className="dd-secondary inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-[12.5px] font-semibold text-ink-secondary sm:h-11 sm:px-5 sm:text-[13px]"
            >
              See founding plan
            </Link>
          </div>
          <p className="mt-3.5 max-w-xl text-[11px] leading-5 text-ink-muted sm:text-[11.5px]">
            No public “verified doctor” claim is made until credential verification is actually available.
          </p>
        </div>

        <div className="dd-landing-demo p-3 sm:p-4">
          <div className="dd-landing-inner rounded-[20px] p-4 sm:rounded-[22px] sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#70698e]">Today</p>
                <p className="mt-1 text-[17px] font-semibold tracking-[-0.025em] text-[#2c2753] sm:text-[19px]">Doctor workspace</p>
              </div>
              <span className="dd-chip inline-flex rounded-full px-2.5 py-1.5 text-[10px] font-semibold text-[#5f52c5] sm:text-[10.5px]">
                Private clinical workspace
              </span>
            </div>
            <div className="mt-4 grid gap-2.5">
              {workflow.map((item, i) => (
                <div
                  key={item}
                  className="dd-workflow-row flex min-h-[44px] items-center gap-2.5 rounded-[15px] px-3 py-2.5 text-[12px] font-medium text-[#48425f] sm:min-h-[48px] sm:rounded-[16px] sm:px-3.5 sm:text-[12.5px]"
                >
                  <span className="dd-step grid size-7 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold text-[#6554d0]">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{item}</span>
                  <CheckCircle2 className="size-3.5 shrink-0 text-[#72cdbb]" aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-7 lg:px-7 lg:py-8">
        <div className="grid gap-3 md:grid-cols-3">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="dd-public-card p-4 sm:p-5">
              <span className="dd-feature-icon inline-flex size-9 items-center justify-center rounded-[13px] text-[#6655cf]">
                {benefit.icon}
              </span>
              <h2 className="mt-3 text-[15.5px] font-semibold tracking-[-0.02em] text-[#302a59] sm:text-[16.5px]">{benefit.title}</h2>
              <p className="mt-1.5 text-[12.5px] leading-5.5 text-ink-secondary sm:text-[13px] sm:leading-6">{benefit.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-9 sm:px-5 sm:py-11 lg:px-7 lg:py-12">
        <div className="dd-public-cta px-5 py-6 sm:px-7 lg:flex lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6554d0]">Founding doctors</p>
            <h2 className="mt-2.5 text-[24px] leading-tight font-semibold tracking-[-0.035em] text-[#2b254f] sm:text-[28px]">Help shape the workflow before wider launch.</h2>
            <p className="mt-2.5 max-w-2xl text-[13px] leading-6 text-ink-secondary sm:text-[13.5px]">
              Early doctors get high-touch onboarding and an early-user commercial plan while pilot evidence is completed.
            </p>
          </div>
          <Link
            href="/pricing"
            className="dd-secondary mt-5 inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-[12.5px] font-semibold text-ink-secondary lg:mt-0"
          >
            View the plan
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
