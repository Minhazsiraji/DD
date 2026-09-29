import Link from "next/link";
import { BadgeCheck, BadgeQuestionMark, MapPin } from "lucide-react";
import type { PublicDoctor } from "../queries";
import { PublicDoctorAvatar } from "./public-doctor-avatar";

export function CompactDoctorCard({ doctor, photoUrl }: { doctor: PublicDoctor; photoUrl: string | null }) {
  const locations = doctor.chambers
    .map((chamber) => chamber.district || chamber.name)
    .filter(Boolean)
    .slice(0, 2);

  return (
    <article className="dd-material-record dd-record-pearl min-w-0 rounded-3xl p-5">
      <div className="flex min-w-0 items-start gap-4">
        <PublicDoctorAvatar fullName={doctor.fullName} photoUrl={photoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-ink">{doctor.fullName}</h2>
            {doctor.verified ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><BadgeCheck className="size-4" /> Verified</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted opacity-65 grayscale"><BadgeQuestionMark className="size-4 blur-[0.4px]" /> Not verified</span>
            )}
          </div>          <p className="mt-1 text-sm text-ink-secondary">
            {[doctor.specialization, doctor.qualification].filter(Boolean).join(" · ") || doctor.designation || "Doctor"}
          </p>
          {locations.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{locations.join(" · ")}</span>
            </p>
          )}
          <Link
            href={`/dr/${encodeURIComponent(doctor.slug)}`}
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-white/80 bg-white/60 px-4 text-sm font-semibold text-brand shadow-soft focus-visible:focus-ring"
          >
            View full profile
          </Link>
        </div>
      </div>
    </article>
  );
}
