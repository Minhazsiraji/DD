"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Globe2, Lock, MessageCircle, Share2 } from "lucide-react";
import { setProfileVisibilityAction } from "@/features/doctor/publication-actions";

type Visibility = "PRIVATE" | "PUBLIC";

interface Props {
  slug: string | null;
  visibility: Visibility;
  compact?: boolean;
}

export function PublicProfileControls({ slug, visibility: initialVisibility, compact = false }: Props) {
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [status, setStatus] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const pathname = slug ? `/dr/${encodeURIComponent(slug)}` : null;
  const publicUrl = useMemo(() => {
    if (!pathname || typeof window === "undefined") return pathname ?? "";
    return `${window.location.origin}${pathname}`;
  }, [pathname]);

  async function copyLink(message = "Public profile link copied.") {
    if (!publicUrl || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setStatus(message);
    } catch {
      setStatus("Copy was blocked by the browser. Open the public profile and copy its address.");
    }
  }

  async function shareProfile() {
    if (!publicUrl || visibility !== "PUBLIC") return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Doctor's Diary professional profile", url: publicUrl });
        setStatus("Share sheet opened.");
        return;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
      }
    }
    await copyLink("Link copied — paste it into Messenger, SMS or any app.");
  }

  function openShare(target: "whatsapp" | "facebook") {
    if (!publicUrl || visibility !== "PUBLIC") return;
    const encoded = encodeURIComponent(publicUrl);
    const url = target === "whatsapp"
      ? `https://wa.me/?text=${encodeURIComponent(`Doctor's Diary profile: ${publicUrl}`)}`
      : `https://www.facebook.com/sharer/sharer.php?u=${encoded}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function changeVisibility(next: Visibility) {
    setStatus("");
    startTransition(async () => {
      const result = await setProfileVisibilityAction(next);
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      setVisibility(result.visibility);
      setStatus(result.visibility === "PUBLIC" ? "Profile published." : "Profile is private again.");
    });
  }

  const published = visibility === "PUBLIC";

  return (
    <section className={`rounded-2xl border border-hairline bg-white ${compact ? "p-4" : "p-5 sm:p-6"}`} data-public-profile-controls>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {published ? <Globe2 className="size-4 text-brand" aria-hidden="true" /> : <Lock className="size-4 text-ink-muted" aria-hidden="true" />}
            <h2 className="text-sm font-semibold text-ink">Public doctor profile</h2>
          </div>
          <p className="mt-1 text-xs text-ink-secondary">
            {published ? "Published — anyone with this link can view the approved public fields." : "Private — anonymous visitors cannot view this profile."}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${published ? "bg-brand/10 text-brand" : "bg-surface-muted text-ink-secondary"}`}>
          {published ? "Published" : "Private"}
        </span>
      </div>

      {slug ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Stable public link</p>
          <code className="mt-1 block break-all rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-secondary">{pathname}</code>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Choose and save a profile link below before publishing.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || (!slug && !published)}
          onClick={() => changeVisibility(published ? "PRIVATE" : "PUBLIC")}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-xs font-semibold text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:focus-ring"
        >
          {published ? "Unpublish" : pending ? "Publishing…" : "Publish profile"}
        </button>

        {published && pathname && (
          <>
            <Link href={pathname} target="_blank" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
              <ExternalLink className="size-3.5" aria-hidden="true" /> View public profile
            </Link>
            <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
              <Copy className="size-3.5" aria-hidden="true" /> Copy link
            </button>
            <button type="button" onClick={() => void shareProfile()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
              <Share2 className="size-3.5" aria-hidden="true" /> Share profile
            </button>
            {!compact && (
              <>
                <button type="button" onClick={() => openShare("whatsapp")} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
                  <MessageCircle className="size-3.5" aria-hidden="true" /> WhatsApp
                </button>
                <button type="button" onClick={() => openShare("facebook")} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
                  <Share2 className="size-3.5" aria-hidden="true" /> Facebook
                </button>
                <button type="button" onClick={() => void copyLink("Link copied — paste it into Messenger.")} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
                  <MessageCircle className="size-3.5" aria-hidden="true" /> Messenger
                </button>
              </>
            )}
          </>
        )}
      </div>

      {status && (
        <p role="status" className="mt-3 flex items-start gap-1.5 text-xs text-ink-secondary">
          {status.includes("published") || status.includes("copied") || status.includes("private") ? <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : null}
          {status}
        </p>
      )}
    </section>
  );
}
