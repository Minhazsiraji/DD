"use client";

import { useEffect, useRef, useState } from "react";
import {
  BACKGROUND_PREFERENCE_EVENT,
  loadBackgroundImage,
  overlayCss,
  readBackgroundPreference,
  type BackgroundMode,
} from "@/features/settings/background-preference";
import styles from "./locked-default-background.module.css";

const LOCKED_DEFAULT_COLOR = "#e8e3ee";

const BODY_STYLE_PROPERTIES = [
  "background-color",
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "background-attachment",
  "position",
  "isolation",
  "min-height",
] as const;

const HTML_STYLE_PROPERTIES = ["background-color", "min-height"] as const;

/** Clear only inline properties owned by browser-local background personalization. */
function clearOwnedCanvasStyles(): void {
  for (const property of HTML_STYLE_PROPERTIES) {
    document.documentElement.style.removeProperty(property);
  }

  for (const property of BODY_STYLE_PROPERTIES) {
    document.body.style.removeProperty(property);
  }

  document.body.removeAttribute("data-dd-background-mode");
}

/**
 * Exact authenticated-app canvas selected from md2/inv1-ui-02-layout-fix.
 * The artwork/blur layer itself is rendered below by .defaultLayer; these are
 * the body/html properties that the source preview used around that layer.
 */
function applyLockedDefaultCanvas(): void {
  clearOwnedCanvasStyles();

  document.documentElement.style.setProperty("min-height", "100%");
  document.documentElement.style.setProperty(
    "background-color",
    LOCKED_DEFAULT_COLOR,
    "important",
  );

  document.body.style.setProperty("min-height", "100%");
  document.body.style.setProperty("position", "relative");
  document.body.style.setProperty("isolation", "isolate");
  document.body.style.setProperty(
    "background-color",
    LOCKED_DEFAULT_COLOR,
    "important",
  );
  document.body.style.setProperty("background-image", "none", "important");
  document.body.setAttribute("data-dd-background-mode", "default");
}

export function BackgroundCanvas() {
  const objectUrlRef = useRef<string | null>(null);
  const [mode, setMode] = useState<BackgroundMode>("default");

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
        applyLockedDefaultCanvas();
        if (!cancelled) setMode("default");
        return;
      }

      if (preference.mode === "color") {
        releaseObjectUrl();
        clearOwnedCanvasStyles();
        if (cancelled) return;
        document.body.style.setProperty("background-color", preference.color);
        document.body.style.setProperty("background-image", "none");
        document.body.setAttribute("data-dd-background-mode", "color");
        setMode("color");
        return;
      }

      try {
        const image = await loadBackgroundImage();
        if (cancelled) return;

        releaseObjectUrl();
        clearOwnedCanvasStyles();

        // Missing/unreadable local image returns to the selected DD default.
        if (!image) {
          applyLockedDefaultCanvas();
          setMode("default");
          return;
        }

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
        setMode("image");
      } catch {
        if (!cancelled) {
          applyLockedDefaultCanvas();
          setMode("default");
        }
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
      // Never leak authenticated personalization into login/MFA/public routes.
      clearOwnedCanvasStyles();
    };
  }, []);

  if (mode !== "default") return null;

  return (
    <div
      aria-hidden="true"
      data-dd-locked-default-background="true"
      className={styles.defaultLayer}
    />
  );
}
