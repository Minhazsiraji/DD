import * as React from "react";
import { MapPin, Stethoscope } from "lucide-react";
import type { DoctorProfile, ProfileSession } from "../profile";

/**
 * The doctor's professional profile, as a patient reads it.
 *
 * PURE PRESENTATION. It takes a `DoctorProfile` and renders it — no fetching,
 * no session, no authorisation decision. That is deliberate: the same component
 * will render a future public `/dr/<slug>` page, and the way to be sure a
 * public page cannot leak is for the component to have no way to reach
 * anything. Whoever calls it decides who may see it.
 *
 * The register: calm, printed, medical. A prescription pad's seriousness rather
 * than a directory listing's. No follower counts, no ratings, no badges, no
 * "verified" mark on a self-asserted registration number, no promotional
 * language — a patient reading this should learn who the doctor is and when
 * they sit, and nothing that flatters.
 */

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 24h to the way a Bangladeshi chamber writes it: "6:00 PM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Days that share a time range are written together — "Sun · Tue · Thu",
 * the way a chamber board actually reads. Grouped rather than listed, because
 * seven identical lines is a wall a patient skips.
 */
export function groupSessions(
  sessions: ProfileSession[],
): { days: number[]; startsAt: string; endsAt: string }[] {
  const byRange = new Map<string, { days: number[]; startsAt: string; endsAt: string }>();

  for (const s of sessions) {
    const key = `${s.startsAt}-${s.endsAt}`;
    const existing = byRange.get(key);
    if (existing) existing.days.push(s.weekday);
    else byRange.set(key, { days: [s.weekday], startsAt: s.startsAt, endsAt: s.endsAt });
  }

  return [...byRange.values()]
    .map((g) => ({ ...g, days: [...g.days].sort((a, b) => a - b) }))
    .sort((a, b) => (a.days[0] ?? 0) - (b.days[0] ?? 0) || a.startsAt.localeCompare(b.startsAt));
}

export function DoctorProfileCard({ profile }: { profile: DoctorProfile }) {
  return (
    <article className="clinical-surface mx-auto max-w-[560px] rounded-glass px-6 py-8 sm:px-10 sm:py-10">
      <header className="flex flex-col items-center text-center">
        {profile.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.photoUrl}
            alt=""
            className="size-28 rounded-full object-cover ring-1 ring-hairline"
          />
        ) : (
          /*
            No photo is a normal state, not an error. A grey silhouette would
            read as something missing; the chamber mark reads as a doctor who
            has not added one.
          */
          <span
            className="flex size-28 items-center justify-center rounded-full bg-brand-soft text-brand ring-1 ring-hairline"
            aria-hidden="true"
          >
            <Stethoscope className="size-10" />
          </span>
        )}

        <h1 className="mt-5 text-[22px] leading-tight font-semibold text-ink">
          {profile.fullName}
        </h1>

        {profile.qualification ? (
          <p className="mt-1 text-[14px] font-medium text-ink-secondary">{profile.qualification}</p>
        ) : null}

        {profile.designation ? (
          <p className="mt-2 text-[13px] text-ink-secondary">{profile.designation}</p>
        ) : null}

        {profile.specialization ? (
          <p className="text-[13px] font-medium text-brand">{profile.specialization}</p>
        ) : null}

        {/*
          Shown only when the doctor chose to. BMDC is self-asserted and
          unverified (ADR 0003), so it is presented as a registration number the
          doctor states — never with a tick, a badge, or the word "verified".
        */}
        {profile.bmdc ? (
          <p className="mt-3 font-mono text-[12px] tracking-wide text-ink-muted">
            BMDC Reg. {profile.bmdc}
          </p>
        ) : null}
      </header>

      {profile.chambers.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-center text-[11px] font-semibold tracking-[0.14em] text-ink-muted uppercase">
            Chambers
          </h2>

          <ul className="mt-4 space-y-5">
            {profile.chambers.map((chamber) => (
              <li
                key={chamber.locationId}
                className="border-t border-hairline pt-5 first:border-t-0 first:pt-0"
              >
                <p className="text-[15px] font-semibold text-ink">{chamber.name}</p>

                {chamber.addressLine ? (
                  <p className="mt-0.5 flex items-start gap-1.5 text-[13px] text-ink-secondary">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
                    {chamber.addressLine}
                  </p>
                ) : null}

                {chamber.sessions.length > 0 ? (
                  <dl className="mt-2.5 space-y-1">
                    {groupSessions(chamber.sessions).map((group, i) => (
                      <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <dt className="text-[13px] font-medium text-ink">
                          {group.days.map((d) => DAY_SHORT[d]).join(" · ")}
                        </dt>
                        <dd className="text-[13px] tabular-nums text-ink-secondary">
                          {formatTime(group.startsAt)} – {formatTime(group.endsAt)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  /*
                    Honest about the absence. "By appointment" would be putting
                    words in the doctor's mouth — that note is theirs to write.
                  */
                  <p className="mt-2 text-[13px] text-ink-muted">Visiting hours not listed</p>
                )}

                {chamber.publicNote ? (
                  <p className="mt-2 inline-block rounded-lg bg-surface-muted px-2.5 py-1 text-[12px] font-medium text-ink-secondary">
                    {chamber.publicNote}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-8 text-center text-[13px] text-ink-muted">
          No chambers added to this profile yet.
        </p>
      )}
    </article>
  );
}
