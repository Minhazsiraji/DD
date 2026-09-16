"use client";

import { useState } from "react";
import { Check, Copy, Facebook, MessageCircle, Share2 } from "lucide-react";

interface Props {
  doctorName: string;
}

export function PublicShareActions({ doctorName }: Props) {
  const [status, setStatus] = useState("");

  function currentUrl() {
    return window.location.href.split("#")[0];
  }

  async function copy(message: string) {
    try {
      await navigator.clipboard.writeText(currentUrl());
      setStatus(message);
    } catch {
      setStatus("Copy was blocked by the browser. Copy the address from your browser instead.");
    }
  }

  async function nativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `${doctorName} · Doctor's Diary`, url: currentUrl() });
        return;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
      }
    }
    await copy("Link copied — paste it into Messenger, SMS or any app.");
  }

  function open(target: "whatsapp" | "facebook") {
    const url = currentUrl();
    const targetUrl = target === "whatsapp"
      ? `https://wa.me/?text=${encodeURIComponent(`${doctorName} · Doctor's Diary: ${url}`)}`
      : `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mt-5" data-public-profile-share>
      <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
        <button type="button" onClick={() => void nativeShare()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
          <Share2 className="size-3.5" aria-hidden="true" /> Share profile
        </button>
        <button type="button" onClick={() => void copy("Profile link copied.")} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
          <Copy className="size-3.5" aria-hidden="true" /> Copy link
        </button>
        <button type="button" onClick={() => open("whatsapp")} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
          <MessageCircle className="size-3.5" aria-hidden="true" /> WhatsApp
        </button>
        <button type="button" onClick={() => open("facebook")} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
          <Facebook className="size-3.5" aria-hidden="true" /> Facebook
        </button>
        <button type="button" onClick={() => void copy("Link copied — paste it into Messenger.")} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-xs font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring">
          <MessageCircle className="size-3.5" aria-hidden="true" /> Messenger
        </button>
      </div>
      {status && <p role="status" className="mt-2 flex items-center justify-center gap-1 text-xs text-ink-secondary sm:justify-start"><Check className="size-3.5" aria-hidden="true" />{status}</p>}
    </div>
  );
}
