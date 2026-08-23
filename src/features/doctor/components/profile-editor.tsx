"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, Loader2, Trash2, Upload } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import {
  removeProfilePhotoAction,
  saveChamberScheduleAction,
  saveProfessionalProfileAction,
  uploadProfilePhotoAction,
} from "../profile-actions";
import type { DoctorProfile } from "../profile";

/**
 * Editing the professional profile.
 *
 * The whole task the pilot doctor should manage without instruction: add a
 * photo, check the credentials that are already there, set the hours at each
 * chamber, look at it as a patient. So the page is one column in that order,
 * and "View as patient" sits at the top where it is visible before and after
 * the work rather than only at the end.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface EditableChamber {
  locationId: string;
  name: string;
  addressLine: string | null;
  publicNote: string;
  /** Selected weekdays sharing one time range — the Alpha's one session a day. */
  days: number[];
  startsAt: string;
  endsAt: string;
}

export function ProfileEditor({
  profile,
  chambers,
}: {
  profile: DoctorProfile;
  chambers: EditableChamber[];
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const [details, setDetails] = React.useState({
    qualification: profile.qualification ?? "",
    designation: profile.designation ?? "",
    specialization: profile.specialization ?? "",
    bmdc: "",
    showBmdc: profile.bmdc !== null,
  });
  const [rows, setRows] = React.useState(chambers);

  /**
   * The BMDC field starts EMPTY and only overwrites when typed.
   *
   * `getOwnProfile` returns the number only when the doctor has chosen to show
   * it, so pre-filling from it would silently blank a hidden number the first
   * time the doctor saved anything else. The number itself is unchanged unless
   * they type one.
   */
  async function saveDetails() {
    setSaving("details");
    setNotice(null);
    const result = await saveProfessionalProfileAction({
      qualification: details.qualification,
      designation: details.designation,
      specialization: details.specialization,
      bmdc: details.bmdc,
      showBmdc: details.showBmdc,
      slug: profile.slug ?? "",
    });
    setSaving(null);
    setNotice(
      result.ok ? { kind: "ok", text: "Saved." } : { kind: "bad", text: result.message },
    );
    if (result.ok) router.refresh();
  }

  async function saveChamber(row: EditableChamber) {
    setSaving(row.locationId);
    setNotice(null);
    const result = await saveChamberScheduleAction({
      practiceLocationId: row.locationId,
      publicNote: row.publicNote,
      sessions: row.days.map((weekday) => ({
        weekday,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      })),
    });
    setSaving(null);
    setNotice(
      result.ok
        ? { kind: "ok", text: `${row.name} saved.` }
        : { kind: "bad", text: result.message },
    );
    if (result.ok) router.refresh();
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving("photo");
    setNotice(null);
    const form = new FormData();
    form.set("photo", file);
    const result = await uploadProfilePhotoAction(form);
    setSaving(null);
    e.target.value = "";
    setNotice(
      result.ok ? { kind: "ok", text: "Photo updated." } : { kind: "bad", text: result.message },
    );
    if (result.ok) router.refresh();
  }

  async function removePhoto() {
    setSaving("photo");
    setNotice(null);
    const result = await removeProfilePhotoAction();
    setSaving(null);
    setNotice(
      result.ok ? { kind: "ok", text: "Photo removed." } : { kind: "bad", text: result.message },
    );
    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-secondary">
          Private to you. Nothing here is published or searchable.
        </p>
        <Link
          href="/settings/professional/preview"
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover focus-visible:focus-ring"
        >
          <Eye className="size-4" aria-hidden="true" />
          View profile as patient
        </Link>
      </div>

      {notice ? (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 text-[13px] font-medium ${
            notice.kind === "ok" ? "bg-success-soft text-[#07684a]" : "bg-danger-soft text-[#a81c1c]"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Professional photo" />
        <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoUrl}
              alt="Your professional photo"
              className="size-20 rounded-full object-cover ring-1 ring-hairline"
            />
          ) : (
            <span className="flex size-20 items-center justify-center rounded-full bg-surface-muted text-[11px] text-ink-muted ring-1 ring-hairline">
              No photo
            </span>
          )}

          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-within:focus-ring">
              {saving === "photo" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              {profile.photoUrl ? "Change photo" : "Add photo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={saving !== null}
                onChange={onPhoto}
              />
            </label>

            {profile.photoUrl ? (
              <button
                type="button"
                onClick={removePhoto}
                disabled={saving !== null}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-55 focus-visible:focus-ring"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Remove
              </button>
            ) : null}
          </div>

          {/*
            Said plainly, because the two images are easy to confuse and the
            consequence of confusing them is a signature on a patient page.
          */}
          <p className="w-full text-[12px] text-ink-muted">
            PNG, JPEG or WebP, up to 3 MB. This is your portrait — it is stored
            separately from your prescription signature and never appears on a
            prescription.
          </p>
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Credentials" />
        <div className="space-y-3 p-4 sm:p-5">
          <Field
            label="Degrees / qualifications"
            placeholder="MBBS, FCPS (Medicine)"
            value={details.qualification}
            onChange={(v) => setDetails((d) => ({ ...d, qualification: v }))}
          />
          <Field
            label="Designation"
            placeholder="Associate Professor & Consultant"
            value={details.designation}
            onChange={(v) => setDetails((d) => ({ ...d, designation: v }))}
          />
          <Field
            label="Specialty"
            placeholder="Medicine Specialist"
            value={details.specialization}
            onChange={(v) => setDetails((d) => ({ ...d, specialization: v }))}
          />

          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={details.showBmdc}
              onChange={(e) => setDetails((d) => ({ ...d, showBmdc: e.target.checked }))}
              className="size-4 accent-[var(--color-brand)]"
            />
            Show my BMDC registration number on my profile
          </label>

          <Field
            label="BMDC registration number"
            placeholder={profile.bmdc ?? "Leave blank to keep the number you have"}
            value={details.bmdc}
            onChange={(v) => setDetails((d) => ({ ...d, bmdc: v }))}
          />
          <p className="text-[12px] text-ink-muted">
            Self-stated and not verified by Doctor&rsquo;s Diary. It is shown as a
            number you provide, never as a verified badge.
          </p>

          <Save busy={saving === "details"} onClick={saveDetails} />
        </div>
      </SectionCard>

      {rows.map((row) => (
        <SectionCard key={row.locationId} className="overflow-hidden">
          <SectionHeader title={row.name} />
          <div className="space-y-3 p-4 sm:p-5">
            {row.addressLine ? (
              <p className="text-[12px] text-ink-muted">{row.addressLine}</p>
            ) : null}

            <div>
              <span className="text-[13px] font-medium text-ink-secondary">Visiting days</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {DAYS.map((day, i) => {
                  const on = row.days.includes(i);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setRows((all) =>
                          all.map((r) =>
                            r.locationId === row.locationId
                              ? {
                                  ...r,
                                  days: on ? r.days.filter((d) => d !== i) : [...r.days, i].sort(),
                                }
                              : r,
                          ),
                        )
                      }
                      className={`h-11 min-w-11 rounded-xl border px-3 text-[13px] font-semibold transition-colors focus-visible:focus-ring ${
                        on
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-hairline bg-white text-ink-secondary hover:bg-surface-muted"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <TimeField
                label="From"
                value={row.startsAt}
                onChange={(v) =>
                  setRows((all) =>
                    all.map((r) => (r.locationId === row.locationId ? { ...r, startsAt: v } : r)),
                  )
                }
              />
              <TimeField
                label="To"
                value={row.endsAt}
                onChange={(v) =>
                  setRows((all) =>
                    all.map((r) => (r.locationId === row.locationId ? { ...r, endsAt: v } : r)),
                  )
                }
              />
            </div>

            <Field
              label="Note for patients (optional)"
              placeholder="By appointment"
              value={row.publicNote}
              onChange={(v) =>
                setRows((all) =>
                  all.map((r) => (r.locationId === row.locationId ? { ...r, publicNote: v } : r)),
                )
              }
            />

            {/*
              Stated hours, not bookable slots. The two get confused constantly
              and they are different things — this is what the doctor tells
              patients, and it does not open or close an appointment anywhere.
            */}
            <p className="text-[12px] text-ink-muted">
              These are the hours you tell patients you sit here. They do not
              change appointment booking.
            </p>

            <Save busy={saving === row.locationId} onClick={() => saveChamber(row)} />
          </div>
        </SectionCard>
      ))}

      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          Add a chamber under Settings first, and it will appear here.
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-secondary">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring"
      />
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-secondary">
        {label}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-11 rounded-xl border border-hairline bg-white px-3 text-[15px] text-ink tabular-nums focus-visible:focus-ring"
      />
    </div>
  );
}

function Save({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover disabled:opacity-55 focus-visible:focus-ring"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Check className="size-4" aria-hidden="true" />
      )}
      {busy ? "Saving…" : "Save"}
    </button>
  );
}
