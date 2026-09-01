import * as React from "react";

/**
 * Public-profile portrait presentation only.
 *
 * The current anonymous profile RPC does not expose the private storage path,
 * which is intentional. If that RPC later returns a short-lived signed HTTPS
 * URL, this component can render it without ever accepting a raw storage path.
 * Until then the doctor's initials give the hero a complete, professional
 * identity block without weakening the storage boundary.
 */
export function PublicDoctorAvatar({
  fullName,
  photoUrl,
}: {
  fullName: string;
  photoUrl?: string | null;
}) {
  const safeUrl = safePublicPhotoUrl(photoUrl);

  if (safeUrl) {
    return (
      // A signed storage URL is request-scoped and cannot be configured as a
      // static Next Image remote pattern safely for every deployment.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={safeUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="size-24 shrink-0 rounded-3xl object-cover ring-1 ring-slate-200 shadow-sm sm:size-28"
      />
    );
  }

  return (
    <div
      data-public-profile-avatar-fallback
      aria-hidden="true"
      className="grid size-24 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-teal-50 to-slate-100 text-2xl font-semibold tracking-tight text-teal-800 ring-1 ring-slate-200 shadow-sm sm:size-28 sm:text-3xl"
    >
      {doctorInitials(fullName)}
    </div>
  );
}

/** A conservative public image boundary: never render data:, javascript:, or a raw path. */
export function safePublicPhotoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function doctorInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  const first = parts[0]?.[0] ?? "D";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase().slice(0, 2) || "DR";
}
