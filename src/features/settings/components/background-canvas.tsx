"use client";

import { useEffect, useRef, useState } from "react";
import {
  BACKGROUND_PREFERENCE_EVENT,
  loadBackgroundImage,
  overlayCss,
  readBackgroundPreference,
  type BackgroundPreference,
} from "@/features/settings/background-preference";

type AppliedCanvas = BackgroundPreference & {
  imageUrl: string | null;
};

export function BackgroundCanvas() {
  const [canvas, setCanvas] = useState<AppliedCanvas | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const releaseObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    const syncPreference = async () => {
      const preference = readBackgroundPreference();

      if (preference.mode !== "image") {
        releaseObjectUrl();
        if (!cancelled) setCanvas({ ...preference, imageUrl: null });
        return;
      }

      try {
        const image = await loadBackgroundImage();
        if (cancelled) return;

        releaseObjectUrl();
        if (!image) {
          setCanvas({ ...preference, mode: "default", imageUrl: null });
          return;
        }

        const imageUrl = URL.createObjectURL(image);
        objectUrlRef.current = imageUrl;
        setCanvas({ ...preference, imageUrl });
      } catch {
        if (!cancelled) setCanvas({ ...preference, mode: "default", imageUrl: null });
      }
    };

    void syncPreference();
    window.addEventListener(BACKGROUND_PREFERENCE_EVENT, syncPreference);
    window.addEventListener("storage", syncPreference);

    return () => {
      cancelled = true;
      window.removeEventListener(BACKGROUND_PREFERENCE_EVENT, syncPreference);
      window.removeEventListener("storage", syncPreference);
      releaseObjectUrl();
    };
  }, []);

  if (!canvas || canvas.mode === "default") return null;

  const style =
    canvas.mode === "color"
      ? { backgroundColor: canvas.color }
      : canvas.imageUrl
        ? {
            backgroundImage: `linear-gradient(${overlayCss(canvas.overlay)}, ${overlayCss(canvas.overlay)}), url(${JSON.stringify(canvas.imageUrl)})`,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "cover",
          }
        : undefined;

  if (!style) return null;

  return (
    <div
      aria-hidden="true"
      data-dd-custom-background="true"
      className="pointer-events-none fixed inset-0 print:hidden"
      style={{ ...style, zIndex: -1 }}
    />
  );
}
