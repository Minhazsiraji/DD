"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Image as ImageIcon, Palette, RotateCcw, Upload } from "lucide-react";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BACKGROUND_PREFERENCE,
  announceBackgroundPreferenceChange,
  clearBackgroundPreference,
  deleteBackgroundImage,
  hexToRgb,
  isAcceptedBackgroundImageType,
  loadBackgroundImage,
  normalizeHex,
  overlayCss,
  readBackgroundPreference,
  rgbToHex,
  saveBackgroundImage,
  writeBackgroundPreference,
  type BackgroundMode,
} from "@/features/settings/background-preference";

const MODE_COPY: Record<BackgroundMode, { label: string; help: string }> = {
  default: {
    label: "Default",
    help: "Doctor’s Diary’s original main background, unchanged.",
  },
  color: {
    label: "Color",
    help: "Choose a solid background color for this browser.",
  },
  image: {
    label: "Image",
    help: "Use a local image with an optional readability overlay.",
  },
};

const MAIN_DEFAULT_BACKGROUND_IMAGE = [
  "radial-gradient(circle at 90% 10%, transparent 0 7.4rem, rgb(255 255 255 / 0.55) 7.4rem 8rem, transparent 8rem)",
  "radial-gradient(circle at 4% 72%, transparent 0 5.4rem, rgb(255 255 255 / 0.45) 5.4rem 5.9rem, transparent 5.9rem)",
  "radial-gradient(820px 460px at 16% -14%, rgb(255 255 255 / 0.5), transparent 60%)",
  "radial-gradient(900px 520px at 104% 6%, rgb(186 213 253 / 0.75), transparent 58%)",
  "linear-gradient(160deg, #e4edfd 0%, #d5e3fb 46%, #c9dbf9 100%)",
].join(", ");

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}

function MainDefaultPreview() {
  return (
    <div
      className="absolute inset-0"
      data-dd-main-default-preview="true"
      style={{
        backgroundColor: "#dbe7fb",
        backgroundImage: MAIN_DEFAULT_BACKGROUND_IMAGE,
      }}
    />
  );
}

export function BackgroundAppearance() {
  const [mode, setMode] = useState<BackgroundMode>("default");
  const [color, setColor] = useState(DEFAULT_BACKGROUND_COLOR);
  const [hexInput, setHexInput] = useState(DEFAULT_BACKGROUND_COLOR);
  const [rgb, setRgb] = useState(() => hexToRgb(DEFAULT_BACKGROUND_COLOR));
  const [overlay, setOverlay] = useState(0);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [storedImageAvailable, setStoredImageAvailable] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const releasePreviewUrl = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const preference = readBackgroundPreference();
      setMode(preference.mode);
      setColor(preference.color);
      setHexInput(preference.color);
      setRgb(hexToRgb(preference.color));
      setOverlay(preference.overlay);

      try {
        const blob = await loadBackgroundImage();
        if (cancelled || !blob) return;
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setImagePreviewUrl(url);
        setStoredImageAvailable(true);
      } catch {
        // IndexedDB can be unavailable in hardened/private browser modes.
      }
    };

    void load();
    return () => {
      cancelled = true;
      releasePreviewUrl();
    };
  }, []);

  const previewStyle = useMemo(() => {
    if (mode === "color") return { backgroundColor: color };
    if (mode === "image" && imagePreviewUrl) {
      const overlayValue = overlayCss(overlay);
      return {
        backgroundImage: `linear-gradient(${overlayValue}, ${overlayValue}), url(${JSON.stringify(imagePreviewUrl)})`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
      };
    }
    return undefined;
  }, [color, imagePreviewUrl, mode, overlay]);

  const syncColor = (nextColor: string) => {
    const normalized = normalizeHex(nextColor);
    if (!normalized) return;
    setColor(normalized);
    setHexInput(normalized);
    setRgb(hexToRgb(normalized));
    setError(null);
  };

  const updateRgb = (channel: "red" | "green" | "blue", value: string) => {
    const next = { ...rgb, [channel]: clampChannel(Number(value)) };
    const nextHex = rgbToHex(next.red, next.green, next.blue);
    setRgb(next);
    setColor(nextHex);
    setHexInput(nextHex);
    setError(null);
  };

  const updateHexInput = (value: string) => {
    const next = value.toUpperCase();
    setHexInput(next);
    const normalized = normalizeHex(next);
    if (normalized) {
      setColor(normalized);
      setRgb(hexToRgb(normalized));
      setError(null);
    }
  };

  const validateHex = () => {
    const normalized = normalizeHex(hexInput);
    if (!normalized) {
      setError("Enter a six-digit HEX color such as #C8C8C8.");
      return;
    }
    syncColor(normalized);
  };

  const handleImage = (file: File | null) => {
    setStatus(null);
    setError(null);
    if (!file) return;

    if (!isAcceptedBackgroundImageType(file.type)) {
      setError("Choose a PNG, JPG/JPEG or WebP image.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    releasePreviewUrl();
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setImageFile(file);
    setImagePreviewUrl(url);
    setStoredImageAvailable(true);
    setMode("image");
  };

  const apply = async () => {
    setStatus(null);
    setError(null);

    try {
      if (mode === "image") {
        if (!imagePreviewUrl) {
          setError("Choose an image before applying Image mode.");
          return;
        }
        if (imageFile) await saveBackgroundImage(imageFile);
      }

      writeBackgroundPreference({ mode, color, overlay });
      announceBackgroundPreferenceChange();
      setImageFile(null);
      setStatus(
        mode === "default"
          ? "Doctor’s Diary Default is active."
          : `${MODE_COPY[mode].label} background applied on this browser.`,
      );
    } catch {
      setError(
        "This browser could not save the background preference. Try another image or browser window.",
      );
    }
  };

  const restoreDefault = async () => {
    setStatus(null);
    setError(null);

    // Clear every V1 custom preference before repainting the authenticated shell.
    clearBackgroundPreference();
    try {
      await deleteBackgroundImage();
    } catch {
      // Preference reset must still succeed if IndexedDB is unavailable.
    }

    releasePreviewUrl();
    setMode("default");
    setColor(DEFAULT_BACKGROUND_PREFERENCE.color);
    setHexInput(DEFAULT_BACKGROUND_PREFERENCE.color);
    setRgb(hexToRgb(DEFAULT_BACKGROUND_PREFERENCE.color));
    setOverlay(DEFAULT_BACKGROUND_PREFERENCE.overlay);
    setImageFile(null);
    setImagePreviewUrl(null);
    setStoredImageAvailable(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    announceBackgroundPreferenceChange();
    setStatus("Doctor’s Diary Default restored.");
  };

  const removeImage = async () => {
    setStatus(null);
    setError(null);

    try {
      await deleteBackgroundImage();
    } catch {
      setError("The stored image could not be removed from this browser.");
      return;
    }

    releasePreviewUrl();
    setImageFile(null);
    setImagePreviewUrl(null);
    setStoredImageAvailable(false);
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (readBackgroundPreference().mode === "image") {
      clearBackgroundPreference();
      setMode("default");
      setOverlay(0);
      announceBackgroundPreferenceChange();
      setStatus("Custom image removed. Doctor’s Diary Default is active.");
    } else {
      setStatus("Stored custom image removed.");
    }
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-hairline bg-white/70 shadow-sm">
        <div className="border-b border-hairline px-4 py-4 sm:px-5">
          <h2 className="text-base font-semibold text-ink">Background appearance</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Personal to this browser and authenticated workspace only. Clinical documents and print output stay unchanged.
          </p>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-2" aria-label="Background mode">
            {(["default", "color", "image"] as const).map((item) => {
              const active = mode === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setMode(item);
                    setStatus(null);
                    setError(null);
                  }}
                  className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-semibold transition-colors focus-visible:focus-ring sm:px-3 ${
                    active
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-hairline bg-white text-ink hover:bg-surface-muted"
                  }`}
                  aria-pressed={active}
                >
                  {MODE_COPY[item].label}
                </button>
              );
            })}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Live preview
            </p>
            <div className="relative h-40 overflow-hidden rounded-2xl border border-white/90 shadow-inner sm:h-48">
              {mode === "default" ? <MainDefaultPreview /> : null}
              {mode !== "default" ? (
                <div className="absolute inset-0" style={previewStyle} />
              ) : null}
              <div className="absolute inset-x-4 bottom-4 rounded-xl border border-white/90 bg-white/30 p-3 shadow-sm backdrop-blur-md sm:inset-x-6">
                <p className="text-sm font-semibold text-ink">Doctor’s Diary glass preview</p>
                <p className="mt-0.5 text-xs text-ink-secondary">{MODE_COPY[mode].help}</p>
              </div>
            </div>
          </div>

          {mode === "color" ? (
            <div className="space-y-4 rounded-2xl border border-hairline bg-white/55 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex min-h-11 flex-1 items-center gap-3 rounded-xl border border-hairline bg-white px-3 text-sm font-medium text-ink">
                  <Palette className="size-4 text-brand" aria-hidden="true" />
                  Visual color
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => syncColor(event.target.value)}
                    className="ml-auto h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
                    aria-label="Choose background color"
                  />
                </label>

                <label className="flex-1 text-xs font-semibold text-ink-secondary">
                  HEX
                  <input
                    value={hexInput}
                    onChange={(event) => updateHexInput(event.target.value)}
                    onBlur={validateHex}
                    maxLength={7}
                    inputMode="text"
                    className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm font-semibold uppercase text-ink focus-visible:focus-ring"
                    aria-label="HEX background color"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {([
                  ["red", "R"],
                  ["green", "G"],
                  ["blue", "B"],
                ] as const).map(([channel, label]) => (
                  <label key={channel} className="text-xs font-semibold text-ink-secondary">
                    {label}
                    <input
                      type="number"
                      min={0}
                      max={255}
                      value={rgb[channel]}
                      onChange={(event) => updateRgb(channel, event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm font-semibold text-ink focus-visible:focus-ring"
                      aria-label={`${label} background color value`}
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {mode === "image" ? (
            <div className="space-y-4 rounded-2xl border border-hairline bg-white/55 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-muted focus-within:focus-ring">
                  <Upload className="size-4 text-brand" aria-hidden="true" />
                  {storedImageAvailable ? "Replace image" : "Choose image"}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    className="sr-only"
                    onChange={(event) => handleImage(event.target.files?.[0] ?? null)}
                  />
                </label>
                {storedImageAvailable ? (
                  <button
                    type="button"
                    onClick={() => void removeImage()}
                    className="min-h-11 rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
                  >
                    Remove image
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-ink-muted">
                PNG, JPG/JPEG or WebP from this device. No remote image URLs.
              </p>

              <label className="block text-sm font-semibold text-ink">
                Background overlay
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-xs text-ink-muted">Darker</span>
                  <input
                    type="range"
                    min={-60}
                    max={60}
                    step={5}
                    value={overlay}
                    onChange={(event) => setOverlay(Number(event.target.value))}
                    className="min-h-11 flex-1 accent-brand"
                    aria-label="Background image overlay"
                  />
                  <span className="text-xs text-ink-muted">Lighter</span>
                </div>
                <span className="text-xs font-normal text-ink-muted">
                  {overlay === 0
                    ? "Neutral"
                    : overlay > 0
                      ? `${overlay}% lighter`
                      : `${Math.abs(overlay)}% darker`}
                </span>
              </label>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          {status ? (
            <p role="status" className="flex items-center gap-2 text-sm font-medium text-[#07684a]">
              <Check className="size-4" aria-hidden="true" />
              {status}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void apply()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm hover:opacity-95 focus-visible:focus-ring"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => void restoreDefault()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand/30 bg-white px-5 text-sm font-semibold text-brand shadow-sm hover:bg-brand-soft focus-visible:focus-ring sm:ml-auto"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Restore Doctor’s Diary Default
            </button>
          </div>
        </div>
      </section>

      <div className="rounded-2xl border border-hairline bg-white/60 p-4 text-xs leading-5 text-ink-muted sm:p-5">
        <div className="flex gap-2">
          <ImageIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          <p>
            Color preferences stay in this browser. Uploaded image bytes are stored in IndexedDB, not localStorage, and this feature never uploads them.
          </p>
        </div>
      </div>
    </div>
  );
}
