"use client";

import { useEffect, useRef } from "react";
import {
  BACKGROUND_PREFERENCE_EVENT,
  loadBackgroundImage,
  overlayCss,
  readBackgroundPreference,
} from "@/features/settings/background-preference";
import styles from "./locked-default-background.module.css";

const BODY_STYLE_PROPERTIES = [
  "background-color",
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "background-attachment",
] as const;

const HTML_STYLE_PROPERTIES = ["background-color"] as const;

/** Remove only inline properties and mode markers owned by personalization. */
function clearOwnedCanvasStyles(): void {
  for (const property of HTML_STYLE_PROPERTIES) {
    document.documentElement.style.removeProperty(property);
  }
  document.documentElement.removeAttribute("data-dd-background-mode");

  for (const property of BODY_STYLE_PROPERTIES) {
    document.body.style.removeProperty(property);
  }
  document.body.removeAttribute("data-dd-background-mode");
}

function markMode(mode: "color" | "image"): void {
  document.documentElement.setAttribute("data-dd-background-mode", mode);
  document.body.setAttribute("data-dd-background-mode", mode);
}

/**
 * Default intentionally applies no canvas styling at all.
 * The exact reference background is owned by src/app/global-background-test.css
 * at the root runtime layer, matching md2/inv1-ui-02-layout-fix.
 */
function applyExactReferenceDefault(): void {
  clearOwnedCanvasStyles();
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

      if (preference.mode === "default") {
        releaseObjectUrl();
        applyExactReferenceDefault();
        return;
      }

      if (preference.mode === "color") {
        releaseObjectUrl();
        clearOwnedCanvasStyles();
        if (cancelled) return;

        markMode("color");
        document.documentElement.style.setProperty(
          "background-color",
          preference.color,
          "important",
        );
        document.body.style.setProperty(
          "background-color",
          preference.color,
          "important",
        );
        document.body.style.setProperty("background-image", "none", "important");
        return;
      }

      try {
        const image = await loadBackgroundImage();
        if (cancelled) return;

        releaseObjectUrl();
        clearOwnedCanvasStyles();

        // Missing/unreadable local image fails safely back to the exact default.
        if (!image) {
          applyExactReferenceDefault();
          return;
        }

        const imageUrl = URL.createObjectURL(image);
        objectUrlRef.current = imageUrl;
        const overlay = overlayCss(preference.overlay);

        markMode("image");
        document.body.style.setProperty(
          "background-image",
          `linear-gradient(${overlay}, ${overlay}), url(${JSON.stringify(imageUrl)})`,
          "important",
        );
        document.body.style.setProperty("background-position", "center");
        document.body.style.setProperty("background-repeat", "no-repeat");
        document.body.style.setProperty("background-size", "cover");
        document.body.style.setProperty("background-attachment", "fixed");
      } catch {
        if (!cancelled) applyExactReferenceDefault();
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
      // Leaving the authenticated shell must not leak personalization state.
      clearOwnedCanvasStyles();
    };
  }, []);

  // Keeps the CSS module loaded for custom-mode pseudo-layer suppression and
  // the Appearance Default thumbnail. It renders no visible application UI.
  return <span aria-hidden="true" className={styles.referenceBackgroundStyle} />;
}
