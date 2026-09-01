import { PublicDoctorAvatar } from "./public-doctor-avatar";

/**
 * DOCTOR IDENTITY, then CREDIBILITY. Chambers and booking come after.
 *
 * The old hero ran designation, specialty and qualifications together as one
 * dot-separated line, which reads as a single sentence of small grey text and
 * gives a consultant's twenty years the same weight as a comma. Identity is now
 * the loudest thing on the page, credibility sits under it as discrete facts,
 * and everything below is logistics.
 *
 * NOTHING HERE IS INVENTED. Every field renders only when the profile actually
 * carries it — a doctor who has filled in three things gets a hero with three
 * things in it, not a scaffold of empty labels. The optional props exist so the
 * shape is ready if the profile grows a bio or sub-specialties; today the
 * profile has no such columns and they simply never arrive.
 */
export function DoctorHero({
  fullName,
  photoUrl,
  designation,
  specialization,
  qualification,
  bmdc,
  subSpecialties,
  bio,
  languages,
  yearsOfExperience,
}: {
  fullName: string;
  photoUrl: string | null;
  designation: string | null;
  specialization: string | null;
  qualification: string | null;
  /** Shown as the doctor entered it. A registration number is not a badge. */
  bmdc: string | null;
  subSpecialties?: readonly string[] | null;
  bio?: string | null;
  languages?: readonly string[] | null;
  yearsOfExperience?: number | null;
}) {
  const credibility = [
    qualification ? { label: "Qualifications", value: qualification } : null,
    yearsOfExperience && yearsOfExperience > 0
      ? { label: "Experience", value: `${yearsOfExperience} years` }
      : null,
    languages && languages.length > 0
      ? { label: "Speaks", value: languages.join(", ") }
      : null,
    bmdc ? { label: "BMDC registration", value: bmdc } : null,
  ].filter((x): x is { label: string; value: string } => x !== null);

  return (
    <div className="min-w-0 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      {/*
        A quiet band behind the portrait. It gives the hero a top edge without
        a photographic banner nobody has uploaded — the premium comes from
        spacing and type, not from stock imagery.
      */}
      <div className="h-20 bg-gradient-to-br from-teal-50 via-white to-slate-50 sm:h-24" />

      <div className="min-w-0 px-5 pb-7 sm:px-8 sm:pb-9 lg:px-10">
        {/*
          Stacked and centred on a phone, side by side from `sm`. The portrait
          overlaps the band above so the identity block starts high on the card.
        */}
        <div className="-mt-12 flex min-w-0 flex-col items-center gap-5 text-center sm:-mt-14 sm:flex-row sm:items-end sm:gap-7 sm:text-left">
          <div className="shrink-0 rounded-full bg-white p-1.5 shadow-sm ring-1 ring-slate-200">
            <PublicDoctorAvatar fullName={fullName} photoUrl={photoUrl} />
          </div>

          <div className="min-w-0 flex-1 sm:pb-1">
            <h1 className="min-w-0 break-words text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">
              {fullName}
            </h1>

            {(designation || specialization) && (
              <p className="mt-2 flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
                {designation && (
                  <span className="break-words text-[0.95rem] font-medium text-slate-700 sm:text-lg">
                    {designation}
                  </span>
                )}
                {designation && specialization && (
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                )}
                {specialization && (
                  <span className="break-words rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800 ring-1 ring-inset ring-teal-100">
                    {specialization}
                  </span>
                )}
              </p>
            )}

            {subSpecialties && subSpecialties.length > 0 && (
              <p className="mt-2.5 flex min-w-0 flex-wrap justify-center gap-1.5 sm:justify-start">
                {subSpecialties.map((s) => (
                  <span
                    key={s}
                    className="break-words rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                  >
                    {s}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>

        {bio && (
          <p className="mt-6 max-w-2xl break-words text-[0.95rem] leading-relaxed text-slate-600">
            {bio}
          </p>
        )}

        {credibility.length > 0 && (
          <dl className="mt-6 grid min-w-0 gap-x-8 gap-y-4 border-t border-slate-100 pt-6 sm:grid-cols-2">
            {credibility.map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {item.label}
                </dt>
                <dd className="mt-1 min-w-0 break-words text-[0.95rem] text-slate-800">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/*
          Said once, plainly, and only when a number is shown. Doctor's Diary
          does not verify BMDC registrations, and a number on a profile beside a
          clinic's name reads like a checked credential unless it says otherwise.
        */}
        {bmdc && (
          <p className="mt-4 break-words text-xs text-slate-500">
            Registration number as entered by the doctor. Doctor&rsquo;s Diary does not verify it,
            and showing it does not imply a verification badge.
          </p>
        )}
      </div>
    </div>
  );
}
