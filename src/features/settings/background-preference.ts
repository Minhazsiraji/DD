export type BackgroundMode = "default" | "color" | "image";

export type BackgroundPreference = {
  mode: BackgroundMode;
  color: string;
  overlay: number;
};

/**
 * This is only the initial value shown when someone first opens Custom Color.
 * It is NOT applied in Default mode. Default mode deliberately applies no
 * inline canvas styles and lets src/app/globals.css remain authoritative.
 */
export const DEFAULT_BACKGROUND_COLOR = "#DBE7FB";
export const DEFAULT_BACKGROUND_PREFERENCE: BackgroundPreference = {
  mode: "default",
  color: DEFAULT_BACKGROUND_COLOR,
  overlay: 0,
};

export const BACKGROUND_PREFERENCE_EVENT = "dd-background-preference-change";

const STORAGE_KEY = "dd-background-preference-v1";
const DB_NAME = "doctors-diary-appearance-v1";
const DB_VERSION = 1;
const STORE_NAME = "background-assets";
const IMAGE_KEY = "background-image";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9A-F]{6}$/.test(withHash) ? withHash : null;
}

export function rgbToHex(red: number, green: number, blue: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();

  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

export function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const normalized = normalizeHex(hex) ?? DEFAULT_BACKGROUND_COLOR;
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

export function clampOverlay(value: number): number {
  return Math.max(-60, Math.min(60, Math.round(value)));
}

export function overlayCss(value: number): string {
  const clamped = clampOverlay(value);
  if (clamped === 0) return "rgb(255 255 255 / 0)";

  const alpha = Math.abs(clamped) / 100;
  return clamped > 0
    ? `rgb(255 255 255 / ${alpha})`
    : `rgb(0 0 0 / ${alpha})`;
}

export function isAcceptedBackgroundImageType(type: string): boolean {
  return ACCEPTED_IMAGE_TYPES.has(type.toLowerCase());
}

function isBackgroundMode(value: unknown): value is BackgroundMode {
  return value === "default" || value === "color" || value === "image";
}

export function readBackgroundPreference(): BackgroundPreference {
  if (typeof window === "undefined") return DEFAULT_BACKGROUND_PREFERENCE;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BACKGROUND_PREFERENCE;
    const parsed = JSON.parse(raw) as Partial<BackgroundPreference>;
    if (!isBackgroundMode(parsed.mode)) return DEFAULT_BACKGROUND_PREFERENCE;

    return {
      mode: parsed.mode,
      color: normalizeHex(parsed.color ?? "") ?? DEFAULT_BACKGROUND_COLOR,
      overlay: clampOverlay(Number(parsed.overlay ?? 0)),
    };
  } catch {
    return DEFAULT_BACKGROUND_PREFERENCE;
  }
}

export function writeBackgroundPreference(preference: BackgroundPreference): void {
  if (typeof window === "undefined") return;

  // Default has no persisted custom appearance metadata. This makes the absence
  // of a preference semantically identical to Doctor's Diary's main canvas.
  if (preference.mode === "default") {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const safePreference: BackgroundPreference = {
    mode: preference.mode,
    color: normalizeHex(preference.color) ?? DEFAULT_BACKGROUND_COLOR,
    overlay: clampOverlay(preference.overlay),
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safePreference));
}

export function clearBackgroundPreference(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function announceBackgroundPreferenceChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BACKGROUND_PREFERENCE_EVENT));
}

function openBackgroundDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open background storage."));
  });
}

async function runImageTransaction<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  const db = await openBackgroundDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      operation(store, resolve, reject);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Background storage failed."));
    });
  } finally {
    db.close();
  }
}

export async function saveBackgroundImage(file: Blob): Promise<void> {
  await runImageTransaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(file, IMAGE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to save background image."));
  });
}

export async function loadBackgroundImage(): Promise<Blob | null> {
  return runImageTransaction<Blob | null>("readonly", (store, resolve, reject) => {
    const request = store.get(IMAGE_KEY);
    request.onsuccess = () =>
      resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to load background image."));
  });
}

export async function deleteBackgroundImage(): Promise<void> {
  await runImageTransaction<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(IMAGE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to remove background image."));
  });
}
