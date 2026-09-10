"use client";

import { useEffect, useRef } from "react";
import {
  BACKGROUND_PREFERENCE_EVENT,
  loadBackgroundImage,
  overlayCss,
  readBackgroundPreference,
} from "@/features/settings/background-preference";

const CUSTOM_STYLE_PROPERTIES = [
  "background-color",
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "background-attachment",
] as const;

/**
 * Removes every inline property owned by background personalization.
 * Once removed, src/app/globals.css becomes the sole canvas authority again.
 */
function clearCustomBodyBackground(): void {
  const body = document.body;
  for (const property of CUSTOM_STYLE_PROPERTIES) {
    body.style.removeProperty(property);
  }
  body.removeAttribute("data-dd-background-mode");
}

export function BackgroundCanvas() {
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const releaseObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    const applyPreference = async () => {
      const preference = readBackgroundPreference();

      // The locked Default contract: no inline color/image/overlay at all.
      // Removing our styles exposes the unchanged main globals.css canvas.
      if (preference.mode === "default") {
        releaseObjectUrl();
        clearCustomBodyBackground();
        return;
      }

      if (preference.mode === "color") {
        releaseObjectUrl();
        clearCustomBodyBackground();
        if (cancelled) return;
        document.body.style.setProperty("background-color", preference.color);
        document.body.style.setProperty("background-image", "none");
        document.body.setAttribute("data-dd-background-mode", "color");
        return;
      }

      try {
        const image = await loadBackgroundImage();
        if (cancelled) return;

        releaseObjectUrl();
        clearCustomBodyBackground();

        // Missing/unreadable local image fails safely back to the main canvas.
        if (!image) return;

        const imageUrl = URL.createObjectURL(image);
        objectUrlRef.current = imageUrl;
        const overlay = overlayCss(preference.overlay);

        document.body.style.setProperty(
          "background-image",
          `linear-gradient(${overlay}, ${overlay}), url(${JSON.stringify(imageUrl)})`,
        );
        document.body.style.setProperty("background-position", "center");
        document.body.style.setProperty("background-repeat", "no-repeat");
        document.body.style.setProperty("background-size", "cover");
        document.body.style.setProperty("background-attachment", "fixed");
        document.body.setAttribute("data-dd-background-mode", "image");
      } catch {
        if (!cancelled) clearCustomBodyBackground();
      }
    };

    void applyPreference();
    window.addEventListener(BACKGROUND_PREFERENCE_EVENT, applyPreference);
    window.addEventListener("storage", applyPreference);

    return () => {
      cancelled = true;
      window.removeEventListener(BACKGROUND_PREFERENCE_EVENT, applyPreference);
      window.removeEventListener("storage", applyPreference);
      releaseObjectUrl();
      // Leaving the authenticated application shell must never leak a user's
      // custom canvas into login, MFA, recovery or public Doctor surfaces.
      clearCustomBodyBackground();
    };
  }, []);

  return null;
}
