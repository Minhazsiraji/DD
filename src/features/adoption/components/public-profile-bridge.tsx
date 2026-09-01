import Link from "next/link";
import { Eye, Globe, Lock, CalendarClock, CircleCheck, CircleDashed } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { CopyProfileLink } from "./copy-profile-link";

/**
 * The bridge between "I have a profile" and "a patient can find and book me".
 *
 * Four questions a doctor actually asks, answered on one card: can anyone see
 * me, what is my link, what does it look like, and can they book. Each of them
 * already had an answer somewhere in settings; none of them had an answer in
 * the same place as the others, so the doctor had to assemble it.
 *
 * THIS CARD CHANGES NOTHING. Every control is a link or a copy — visibility is
 * toggled on the professional profile screen and booking on the booking screen,
 * where each has its own confirmation and its own audit trail. A one-click
 * "go public" here would be the fastest possible way to publish a profile
 * somebody had not finished writing.
 */

export interface BridgeChamber {
  id: string;
  name: string;
  bookingEnabled: boolean;
}

interface Props {
  visibility: "PUBLIC" | "PRIVATE" | null;
  slug: string | null;
  chambers: BridgeChamber[] | null;
}

export function PublicProfileBridge({ visibility, slug, chambers }: Props) {
  const isPublic = visibility === "PUBLIC";
  const hasLink = isPublic && !!slug;

  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="How patients find you"
        icon={<Globe className="size-4" />}
        action={
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset " +
              (isPublic
                ? "bg-success-soft text-[#07684a] ring-[#b9e7d5]"
                : "bg-surface-muted text-ink-secondary ring-hairline")
            }
          >
            {isPublic ? (
              <Globe className="size-3.5" aria-hidden="true" />
            ) : (
              <Lock className="size-3.5" aria-hidden="true" />
            )}
            {visibility === null ? "Unknown" : isPublic ? "Public" : "Private"}
          </span>
        }
      />

      <div className="space-y-4 p-4 sm:p-5">
        {hasLink ? (
          <CopyProfileLink path={`/dr/${slug}`} />
        ) : (
          <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink-secondary">
            {isPublic
              ? "Your profile is public but has no link yet. Choose a profile address on the professional profile screen so patients have something to open."
              : "Your profile is private. Nobody outside Doctor's Diary can see it, and there is no link to share yet."}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {/*
            Preview works whether the profile is public or private, and that is
            the point: the way to decide whether to publish is to look at what
            would be published.
          */}
          <Link
            href="/settings/professional/preview"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            <Eye className="size-4 text-brand" aria-hidden="true" />
            Preview as a patient
          </Link>
          <Link
            href="/settings/professional"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            {isPublic ? (
              <Lock className="size-4 text-brand" aria-hidden="true" />
            ) : (
              <Globe className="size-4 text-brand" aria-hidden="true" />
            )}
            {isPublic ? "Visibility & details" : "Make it public"}
          </Link>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink">Booking, chamber by chamber</h3>
          {chambers === null ? (
            <p className="mt-2 text-sm text-ink-secondary">
              Your chambers could not be loaded just now.
            </p>
          ) : chambers.length === 0 ? (
            <p className="mt-2 text-sm text-ink-secondary">
              No chambers on your profile yet. A chamber is what a patient books
              into, so booking starts there.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-hairline rounded-xl border border-hairline">
              {chambers.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    className={c.bookingEnabled ? "text-[#07684a]" : "text-ink-muted"}
                    aria-hidden="true"
                  >
                    {c.bookingEnabled ? (
                      <CircleCheck className="size-4" />
                    ) : (
                      <CircleDashed className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                  <span
                    className={
                      "shrink-0 text-xs font-semibold " +
                      (c.bookingEnabled ? "text-[#07684a]" : "text-ink-secondary")
                    }
                  >
                    {c.bookingEnabled ? "Bookable" : "Not bookable"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/settings/booking"
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
          >
            <CalendarClock className="size-4 text-brand" aria-hidden="true" />
            Booking settings
          </Link>
        </div>

        <p className="text-xs text-ink-muted">
          A public profile shows your name, credentials, chambers and hours. It
          never shows a patient, an appointment or anything from a consultation.
        </p>
      </div>
    </SectionCard>
  );
}
