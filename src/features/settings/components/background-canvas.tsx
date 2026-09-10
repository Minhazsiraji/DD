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

/**
 * Screen-only copy of the authoritative background declarations from
 * md2/inv1-ui-02-layout-fix. The only adaptation is mode scoping so an
 * explicitly selected Color/Image preference can replace the default.
 *
 * No print declarations live here: the frozen clinical print contract remains
 * owned by src/app/globals.css.
 */
const EXACT_REFERENCE_BACKGROUND_CSS = `
@media screen {
  :root {
    --dd-organ-bg: url("/dd-global-bg.webp");
  }

  html:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]),
  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]) {
    min-height: 100%;
    background-color: #e8e3ee !important;
  }

  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]) {
    position: relative;
    isolation: isolate;
    background-image: none !important;
  }

  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"])::before {
    content: "";
    position: fixed;
    inset: -18px;
    z-index: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgb(246 243 250 / 0.28), rgb(246 243 250 / 0.28)),
      var(--dd-organ-bg);
    background-size: cover;
    background-position: center center;
    background-repeat: no-repeat;
    filter: blur(8px);
    transform: scale(1.02);
    transform-origin: center;
  }

  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]) > * {
    position: relative;
    z-index: 1;
  }

  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]) .dd-public-stage,
  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]) .dd-auth-shell,
  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]) > div[class*="min-h-dvh"],
  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]) > main[class*="min-h-dvh"] {
    background-color: transparent !important;
    background-image: none !important;
  }

  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"]) .dd-public-stage-light {
    display: none !important;
  }
}

@media screen and (max-width: 767px) {
  body:not([data-dd-background-mode="color"]):not([data-dd-background-mode="image"])::before {
    background-position: center top;
    filter: blur(7px);
    transform: scale(1.035);
  }
}
`;

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

function markMode(mode: "default" | "color" | "image"): void {
  document.documentElement.setAttribute("data-dd-background-mode", mode);
  document.body.setAttribute("data-dd-background-mode", mode);
}

function applyExactReferenceDefault(): void {
  clearOwnedCanvasStyles();
  markMode("default");
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
        document.body.style.setProperty("background-color", preference.color);
        document.body.style.setProperty("background-image", "none");
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

  return (
    <style
      data-dd-reference-background="true"
      className={styles.referenceBackgroundStyle}
      dangerouslySetInnerHTML={{ __html: EXACT_REFERENCE_BACKGROUND_CSS }}
    />
  );
}
