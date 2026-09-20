import Link from "next/link";
import { MarketingPage } from "@/components/marketing/marketing-shell";
import { publicPageMetadata } from "@/lib/seo";

const description =
  "Doctor's Diary by AgentSiraji helps doctors reduce repetitive typing and workflow burden with voice notes, voice commands, structured automation and doctor-controlled AI-assisted Autopilot.";

export const metadata = publicPageMetadata({
  title: "For Doctors",
  description,
  path: "/for-doctors",
});

const discoveryLinks = [
  ["Voice-Controlled Prescription Software", "/learn/doctors/voice-controlled-prescription-software"],
  ["Creating Prescriptions Without Typing", "/learn/doctors/prescriptions-without-typing"],
  ["AI Autopilot for Clinical Documentation", "/learn/doctors/ai-autopilot-clinical-documentation"],
  ["English, Bangla and Banglish Voice Clinical Notes", "/learn/doctors/english-bangla-banglish-voice-clinical-notes"],
  ["AI Prescription Software With Doctor Final Approval", "/learn/doctors/ai-prescription-doctor-final-approval"],
  ["Voice Commands for Consultation Documentation", "/learn/doctors/voice-commands-consultation-documentation"],
  ["AI-Assisted Investigation and Diagnosis Workflow", "/learn/doctors/ai-assisted-investigation-diagnosis-workflow"],
  ["Doctor-in-the-Loop Medical AI", "/learn/doctors/doctor-in-the-loop-medical-ai"],
] as const;

export default function ForDoctorsPage() {
  return (
    <MarketingPage
      eyebrow="For Doctors"
      title="Less typing. More patient time."
      intro="Doctor’s Diary is designed to reduce repetitive documentation and navigation through voice clinical notes, voice commands, structured text automation and AI-assisted Autopilot—while keeping the Doctor in control of every final clinical decision."
    >
      <section className="dd-material-record dd-record-pearl p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand">Product principle</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink">AI prepares. Doctor decides.</h2>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-ink-secondary">
          The preferred workflow is <strong className="text-ink">Speak → Structure → Review → Confirm</strong>. Voice and AI can help prepare editable notes or structured proposals; the Doctor reviews, edits, accepts or applies them. Prescription finalization and other final clinical decisions remain Doctor-controlled.
        </p>
      </section>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {[
          ["Voice → editable draft → Doctor Accept", "For clinical notes, dictated content remains editable until the Doctor explicitly accepts it."],
          ["Instruction → proposal → review/edit → Apply", "For supported medicine, investigation and follow-up actions, Doctor's Diary prepares a structured proposal before any supported write."],
          ["Final confirmation stays with the Doctor", "AI cannot independently finalize a prescription or turn a diagnosis-related suggestion into the Doctor's final clinical decision."],
        ].map(([title, body]) => (
          <article key={title} className="dd-material-record dd-record-pearl p-6">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-3 leading-7 text-ink-secondary">{body}</p>
          </article>
        ))}
      </div>

      <section className="mt-8 dd-material-record dd-record-pearl p-6 sm:p-8">
        <h2 className="text-2xl font-semibold text-ink">Current voice and Autopilot positioning</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <p className="font-semibold text-ink">PILOT</p>
            <p className="mt-2 leading-7 text-ink-secondary">
              Voice clinical notes, English/Bangla/mixed-script Banglish dictation, supported voice commands, and structured medicine/investigation/follow-up proposal workflows are positioned as pilot capabilities. No measured accuracy or time-saving percentage is claimed here.
            </p>
          </div>
          <div>
            <p className="font-semibold text-ink">PLANNED / not currently qualified</p>
            <p className="mt-2 leading-7 text-ink-secondary">
              Autonomous diagnosis is not a Doctor's Diary capability. Diagnosis-related AI assistance beyond organizing or structuring Doctor-provided information is not represented as currently qualified; final diagnosis and interpretation remain with the Doctor.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-semibold text-ink">Explore voice, Autopilot and doctor-in-the-loop workflows</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {discoveryLinks.map(([title, href]) => (
            <Link key={href} href={href} className="dd-material-record dd-record-pearl block p-5 font-semibold text-brand hover:underline">
              {title}
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8 dd-material-record dd-record-pearl p-6">
        <h2 className="text-xl font-semibold text-ink">Natural mixed-script Banglish</h2>
        <p className="mt-3 leading-7 text-ink-secondary">
          Doctor's Diary Banglish preserves natural scripts. Preferred example: <strong className="text-ink">Patient এর তিন দিন ধরে fever এবং dry cough আছে।</strong> English words stay English and Bangla words stay বাংলা; Romanized Bangla is not the preferred output convention.
        </p>
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/learn/doctors" className="dd-secondary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring">
          Explore Doctor knowledge pages
        </Link>
        <Link href="/security" className="dd-secondary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring">
          Privacy and security
        </Link>
        <Link href="/signup" className="dd-primary inline-flex min-h-11 items-center px-5 py-3 text-sm font-semibold focus-visible:focus-ring">
          Start free
        </Link>
      </div>
    </MarketingPage>
  );
}
